import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/middleware/errorHandler.js";
import { encryptSecret, decryptSecret } from "@/lib/crypto.js";
import {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  upsertCalendarEvent,
  deleteCalendarEvent,
  googleCalendarConfigured,
} from "@/lib/googleCalendar.js";
import {
  getBarber,
  saveGoogleCalendarConnection,
  clearGoogleCalendarConnection,
  updateGoogleCalendarAccessToken,
} from "@/modules/professionals/professionals.repository.js";
import type { AppointmentDTO } from "@/modules/appointments/appointments.types.js";

export { googleCalendarConfigured };

export function getConnectUrl(professionalId: number, redirectUri: string): string {
  // state carrega o professionalId — o callback (requireAuth) já valida
  // separadamente que quem está chamando tem permissão sobre esse
  // barbeiro, então o state em si só precisa ser "difícil de adivinhar
  // por acidente", não criptograficamente assinado.
  return buildGoogleAuthUrl(redirectUri, String(professionalId));
}

export async function getConnectStatus(professionalId: number) {
  const professional = await getBarber(professionalId);
  return {
    connected: !!professional?.googleCalendarConnectedAt,
    connectedAt: professional?.googleCalendarConnectedAt ?? null,
  };
}

export async function handleOAuthCallback(professionalId: number, code: string, redirectUri: string): Promise<void> {
  const tokens = await exchangeCodeForTokens(code, redirectUri);
  if (!tokens.refreshToken) {
    // Acontece se o barbeiro já tinha autorizado antes e o Google não
    // reemite refresh_token numa reautorização sem prompt=consent — como
    // sempre mandamos prompt=consent (ver buildGoogleAuthUrl), isso não
    // deveria ocorrer no fluxo normal, mas falhar alto aqui é melhor que
    // salvar uma conexão que vai parar de funcionar assim que o
    // access_token expirar (~1h) sem jeito de renovar.
    throw new AppError("Google não devolveu um refresh token — tente desconectar e conectar de novo.");
  }
  await saveGoogleCalendarConnection(professionalId, {
    tokenEnc: encryptSecret(tokens.accessToken),
    refreshTokenEnc: encryptSecret(tokens.refreshToken),
    calendarId: "primary", // v1: sempre a agenda principal da conta Google conectada
  });
}

export async function disconnectGoogleCalendar(professionalId: number): Promise<void> {
  await clearGoogleCalendarConnection(professionalId);
}

// access_token dura ~1h e não guardamos o timestamp de expiração — mais
// simples "tentar, e se der 401 renovar e tentar de novo uma vez" do que
// manter um segundo campo de expiresAt sincronizado.
async function withFreshToken<T>(
  professionalId: number,
  tokenEnc: string,
  refreshTokenEnc: string,
  fn: (accessToken: string) => Promise<T>
): Promise<T> {
  try {
    return await fn(decryptSecret(tokenEnc));
  } catch (err) {
    const message = (err as Error).message;
    if (!message.includes("401") && !message.includes("invalid_token") && !message.includes("UNAUTHENTICATED")) throw err;
    const newAccessToken = await refreshAccessToken(decryptSecret(refreshTokenEnc));
    await updateGoogleCalendarAccessToken(professionalId, encryptSecret(newAccessToken));
    return fn(newAccessToken);
  }
}

// Best-effort de propósito: chamado de dentro de createAppointment/
// rescheduleAppointment (appointments.service.ts) depois que o agendamento
// já foi gravado no nosso banco — uma falha aqui (Google fora do ar, token
// revogado etc.) nunca deve impedir o agendamento em si de existir. Só loga.
export async function mirrorAppointmentToGoogle(appointment: AppointmentDTO): Promise<string | null> {
  if (!googleCalendarConfigured) return null;
  const professional = await getBarber(appointment.professionalId);
  if (!professional?.googleCalendarTokenEnc || !professional.googleCalendarRefreshTokenEnc || !professional.googleCalendarId) {
    return null;
  }
  try {
    const eventId = await withFreshToken(
      professional.id,
      professional.googleCalendarTokenEnc,
      professional.googleCalendarRefreshTokenEnc,
      (token) =>
        upsertCalendarEvent(
          token,
          professional.googleCalendarId!,
          {
            summary: `${appointment.serviceName} — ${appointment.clientName}`,
            description: `Agendado via barber. Telefone: ${appointment.clientPhone}`,
            date: appointment.date,
            startTime: appointment.startTime,
            endTime: appointment.endTime,
          },
          appointment.googleEventId
        )
    );
    await prisma.appointment.update({ where: { id: appointment.id }, data: { googleEventId: eventId } });
    return eventId;
  } catch (err) {
    console.error(`[GOOGLE CALENDAR] Falha ao espelhar agendamento #${appointment.id} (não bloqueia o agendamento):`, (err as Error).message);
    return null;
  }
}

export async function removeAppointmentFromGoogle(appointment: AppointmentDTO): Promise<void> {
  if (!googleCalendarConfigured || !appointment.googleEventId) return;
  const professional = await getBarber(appointment.professionalId);
  if (!professional?.googleCalendarTokenEnc || !professional.googleCalendarRefreshTokenEnc || !professional.googleCalendarId) {
    return;
  }
  try {
    await withFreshToken(professional.id, professional.googleCalendarTokenEnc, professional.googleCalendarRefreshTokenEnc, (token) =>
      deleteCalendarEvent(token, professional.googleCalendarId!, appointment.googleEventId!)
    );
  } catch (err) {
    console.error(`[GOOGLE CALENDAR] Falha ao remover evento do agendamento #${appointment.id} (não bloqueia o cancelamento):`, (err as Error).message);
  }
}
