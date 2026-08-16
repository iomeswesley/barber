// Integração com Google Calendar via fetch puro (sem o pacote googleapis —
// mesmo critério já usado pro WhatsApp: menos dependência pesada, a API
// REST do Google é simples o bastante pra não justificar o SDK). MVP de
// exportação (Fase 8a do roadmap): espelha Appointment -> evento no Google
// Agenda do profissional que conectou a conta. Não é sync bidirecional —
// mudanças feitas DIRETO no Google não voltam pro sistema (Fase 8b, futura).
import { env } from "@/config/env.js";

export const googleCalendarConfigured = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

const OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
// calendar.events (não o escopo "calendar" completo) — só cria/edita/apaga
// evento, não lê nem apaga a agenda inteira do profissional.
const SCOPE = "https://www.googleapis.com/auth/calendar.events";

function requireConfigured() {
  if (!googleCalendarConfigured) {
    throw new Error("Integração com Google Agenda ainda não configurada no servidor.");
  }
}

// `state` carrega o professionalId (assinado indiretamente pela sessão —
// o callback só aceita o retorno de quem já está autenticado como esse
// profissional/dono, então o state em si não precisa ser um JWT).
export function buildGoogleAuthUrl(redirectUri: string, state: string): string {
  requireConfigured();
  const url = new URL(OAUTH_BASE);
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  // access_type=offline + prompt=consent: sem os dois juntos o Google só
  // manda refresh_token na PRIMEIRA autorização de cada conta Google —
  // reconectar depois de revogar o acesso não devolveria um novo.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number;
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<GoogleTokens> {
  requireConfigured();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Falha ao trocar code por token do Google (${res.status}): ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return { accessToken: data.access_token, refreshToken: data.refresh_token || null, expiresInSec: data.expires_in };
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  requireConfigured();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Falha ao renovar token do Google (${res.status}): ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export interface CalendarEventInput {
  summary: string;
  description?: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  timeZone?: string;
}

function toRfc3339(date: string, time: string): string {
  return `${date}T${time}:00`;
}

// Cria (sem eventId) ou atualiza (com eventId) o evento. Retorna o id do
// evento no Google — quem chama grava em Appointment.googleEventId.
export async function upsertCalendarEvent(
  accessToken: string,
  calendarId: string,
  input: CalendarEventInput,
  eventId?: string | null
): Promise<string> {
  const body = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: toRfc3339(input.date, input.startTime), timeZone: input.timeZone || "America/Sao_Paulo" },
    end: { dateTime: toRfc3339(input.date, input.endTime), timeZone: input.timeZone || "America/Sao_Paulo" },
  };
  const url = eventId
    ? `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
    : `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`;
  const res = await fetch(url, {
    method: eventId ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Falha ao salvar evento no Google Agenda (${res.status}): ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function deleteCalendarEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
  const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // 410 Gone = evento já tinha sido apagado direto no Google — não é erro
  // pro nosso propósito (o resultado desejado, "evento não existe", já vale).
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Falha ao remover evento do Google Agenda (${res.status}): ${await res.text().catch(() => "")}`);
  }
}
