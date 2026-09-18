import { getAppointmentsNeedingReminder, getTodaysAppointmentsForReminder, ensureConfirmationToken } from "@/modules/appointments/appointments.service.js";
import { markReminderSent } from "@/modules/appointments/appointments.repository.js";
import { getBarbershop } from "@/modules/businesses/businesses.repository.js";
import { metaLanguageCode, normalizeLocale, type Locale } from "@/lib/locale.js";
import { rescheduleNoticeText, comeBackHint, comeBackText, reminderText } from "@/lib/messageCopy.js";
import { sendWhatsappText, sendWhatsappTemplate, whatsappConfigured, resolveBarbershopAccessToken } from "@/lib/whatsapp.js";
import { markWhatsappDisconnectedIfNeeded, markWhatsappReconnectedIfNeeded } from "@/modules/whatsappConnect/whatsappConnect.service.js";
import { tryConsumeWhatsappTrialBudget } from "@/modules/billing/billing.service.js";
import type { AppointmentDTO } from "@/modules/appointments/appointments.types.js";
import { vertical, env } from "@/config/env.js";

const CHECK_INTERVAL_MS = 60 * 1000; // varre a cada minuto

// Envia via WhatsApp Cloud API quando a barbearia tem um número configurado
// (whatsappPhoneNumberId) e algum token disponível — o próprio (WhatsApp
// Connect) ou o global da plataforma; caso contrário cai no stub de sempre
// (só loga no console), pra continuar funcionando em barbearias/ambientes
// sem WhatsApp real conectado.
export async function sendWhatsAppMessage(businessId: number, phone: string, text: string) {
  const barbershop = await getBarbershop(businessId);
  const accessToken = resolveBarbershopAccessToken(barbershop);
  if (barbershop?.whatsappPhoneNumberId && (accessToken || whatsappConfigured)) {
    try {
      await sendWhatsappText(barbershop.whatsappPhoneNumberId, phone, text, accessToken);
      await markWhatsappReconnectedIfNeeded(businessId);
      return;
    } catch (err) {
      console.error(`[WHATSAPP] Falha ao enviar mensagem real, caindo pro stub:`, (err as Error).message);
      await markWhatsappDisconnectedIfNeeded(businessId, err);
    }
  }
  console.log(`\n[LEMBRETE WHATSAPP - STUB] Para: ${phone}\n${text}\n`);
}

// Igual sendWhatsAppMessage, mas via Message Template aprovado — usado pras
// mensagens iniciadas pela barbearia (não em resposta direta a uma mensagem
// do cliente), que a Cloud API só aceita como template fora da janela de
// 24h desde a última interação do cliente. `fallbackText` é só pro stub de
// log (ex: template ainda "PENDING" de aprovação na Meta).
async function sendWhatsAppTemplateMessage(
  businessId: number,
  phone: string,
  templateName: string,
  // Params do template e texto de fallback dependem do idioma (o template
  // aprovado na Meta é por idioma), então quem chama passa uma função em vez
  // dos valores prontos — o idioma só é conhecido aqui, depois de saber se o
  // negócio usa a WABA própria ou o número compartilhado.
  build: (locale: Locale) => { params: string[]; fallbackText: string }
) {
  const barbershop = await getBarbershop(businessId);
  const accessToken = resolveBarbershopAccessToken(barbershop);
  const usingSharedToken = !accessToken;
  // Número compartilhado da plataforma (sem token próprio) só tem os templates
  // pt_BR aprovados; o idioma do negócio só vale na WABA própria, onde
  // createTemplates criou o conjunto no idioma dele.
  const locale: Locale = accessToken ? normalizeLocale(barbershop?.locale) : "pt-BR";
  const { params, fallbackText } = build(locale);
  if (barbershop?.whatsappPhoneNumberId && (accessToken || whatsappConfigured)) {
    const withinBudget = await tryConsumeWhatsappTrialBudget(businessId, usingSharedToken, templateName);
    if (withinBudget) {
      try {
        await sendWhatsappTemplate(barbershop.whatsappPhoneNumberId, phone, templateName, params, metaLanguageCode(locale), accessToken);
        await markWhatsappReconnectedIfNeeded(businessId);
        return;
      } catch (err) {
        console.error(`[WHATSAPP] Falha ao enviar template "${templateName}", caindo pro stub:`, (err as Error).message);
        await markWhatsappDisconnectedIfNeeded(businessId, err);
      }
    } else {
      console.log(`[WHATSAPP] Limite de uso do trial atingido pra "${templateName}" (barbearia ${businessId}), pulando envio real.`);
    }
  }
  console.log(`\n[LEMBRETE WHATSAPP - STUB] Para: ${phone}\n${fallbackText}\n`);
}

export async function sendRescheduleNotice(businessId: number, appointment: AppointmentDTO) {
  await sendWhatsAppTemplateMessage(
    businessId,
    appointment.clientPhone,
    "appointment_reschedule_notice",
    (locale) => ({
      params: [appointment.clientName, appointment.serviceName, appointment.barberName, appointment.startTime, appointment.date],
      fallbackText: buildRescheduleNoticeText(appointment, locale),
    })
  );
}

export function buildRescheduleNoticeText(appointment: AppointmentDTO, locale: string = "pt-BR"): string {
  return rescheduleNoticeText(locale, appointment);
}

export function buildComeBackText(
  clientName: string,
  barbershopName: string,
  lastAppointment: AppointmentDTO | null = null,
  locale: string = "pt-BR"
): string {
  return comeBackText(locale, clientName, barbershopName, lastAppointment, vertical.brandEmoji);
}

// Mensagem de "reconquista" é categoria MARKETING na Meta — exige opt-in
// explícito do cliente (diferente de lembrete/aviso transacional), que é
// checado por quem chama esta função antes de enviar.
export async function sendComeBackMessage(
  businessId: number,
  phone: string,
  clientName: string,
  barbershopName: string,
  lastAppointment: AppointmentDTO | null
) {
  await sendWhatsAppTemplateMessage(
    businessId,
    phone,
    "come_back_message",
    (locale) => ({
      params: [clientName, barbershopName, comeBackHint(locale, lastAppointment)],
      fallbackText: buildComeBackText(clientName, barbershopName, lastAppointment, locale),
    })
  );
}

function confirmationUrl(token: string): string {
  // Aponta pra rota do servidor (não direto pro confirmar.html): ela faz a
  // confirmação e já redireciona pra /confirmar.html?status=ok|invalid —
  // mesmo padrão de GET /api/verify-email (onboarding.routes.ts).
  return `${env.PUBLIC_BASE_URL || ""}/api/public/appointments/confirm?token=${token}`;
}

function buildReminderText(appointment: AppointmentDTO, confirmUrl: string, locale: string = "pt-BR"): string {
  return reminderText(locale, appointment, confirmUrl, vertical.brandEmoji);
}

function reminderTemplateParams(appointment: AppointmentDTO, confirmUrl: string): string[] {
  return [appointment.clientName, appointment.serviceName, appointment.barberName, appointment.startTime, confirmUrl];
}

export async function checkAndSendReminders() {
  const appointments = await getAppointmentsNeedingReminder();
  for (const appointment of appointments) {
    const token = await ensureConfirmationToken(appointment);
    const confirmUrl = confirmationUrl(token);
    await sendWhatsAppTemplateMessage(
      appointment.businessId,
      appointment.clientPhone,
      "appointment_reminder",
      (locale) => ({
        params: reminderTemplateParams(appointment, confirmUrl),
        fallbackText: buildReminderText(appointment, confirmUrl, locale),
      })
    );
    await markReminderSent(appointment.id);
  }
}

// Usado pelo Vercel Cron (roda 1x/dia no plano Hobby): avisa de manhã sobre
// todos os agendamentos de hoje, em vez do lembrete ~1h antes de cada um.
export async function sendDailyReminders() {
  const appointments = await getTodaysAppointmentsForReminder();
  for (const appointment of appointments) {
    const token = await ensureConfirmationToken(appointment);
    const confirmUrl = confirmationUrl(token);
    await sendWhatsAppTemplateMessage(
      appointment.businessId,
      appointment.clientPhone,
      "appointment_reminder",
      (locale) => ({
        params: reminderTemplateParams(appointment, confirmUrl),
        fallbackText: buildReminderText(appointment, confirmUrl, locale),
      })
    );
    await markReminderSent(appointment.id);
  }
}

export function startReminderScheduler() {
  // .catch aqui é essencial: sem ele, qualquer erro (ex: drift de schema,
  // banco fora do ar) vira uma rejeição de Promise não tratada e derruba o
  // processo Node inteiro — um cron de lembrete não pode ter esse poder.
  const runSafely = () => {
    checkAndSendReminders().catch((err) => {
      console.error("[LEMBRETES] Falha na varredura, tentando de novo no próximo ciclo:", (err as Error).message);
    });
  };
  runSafely();
  setInterval(runSafely, CHECK_INTERVAL_MS);
  console.log("Scheduler de lembretes de agendamento iniciado (varredura a cada 1 min).");
}
