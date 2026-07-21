import { getAppointmentsNeedingReminder, getTodaysAppointmentsForReminder } from "@/modules/appointments/appointments.service.js";
import { markReminderSent } from "@/modules/appointments/appointments.repository.js";
import { getBarbershop } from "@/modules/barbershops/barbershops.repository.js";
import { sendWhatsappText, sendWhatsappTemplate, whatsappConfigured, resolveBarbershopAccessToken } from "@/lib/whatsapp.js";
import { tryConsumeWhatsappTrialBudget } from "@/modules/billing/billing.service.js";
import type { AppointmentDTO } from "@/modules/appointments/appointments.types.js";

const CHECK_INTERVAL_MS = 60 * 1000; // varre a cada minuto

// Envia via WhatsApp Cloud API quando a barbearia tem um número configurado
// (whatsappPhoneNumberId) e algum token disponível — o próprio (WhatsApp
// Connect) ou o global da plataforma; caso contrário cai no stub de sempre
// (só loga no console), pra continuar funcionando em barbearias/ambientes
// sem WhatsApp real conectado.
export async function sendWhatsAppMessage(barbershopId: number, phone: string, text: string) {
  const barbershop = await getBarbershop(barbershopId);
  const accessToken = resolveBarbershopAccessToken(barbershop);
  if (barbershop?.whatsappPhoneNumberId && (accessToken || whatsappConfigured)) {
    try {
      await sendWhatsappText(barbershop.whatsappPhoneNumberId, phone, text, accessToken);
      return;
    } catch (err) {
      console.error(`[WHATSAPP] Falha ao enviar mensagem real, caindo pro stub:`, (err as Error).message);
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
  barbershopId: number,
  phone: string,
  templateName: string,
  params: string[],
  fallbackText: string
) {
  const barbershop = await getBarbershop(barbershopId);
  const accessToken = resolveBarbershopAccessToken(barbershop);
  const usingSharedToken = !accessToken;
  if (barbershop?.whatsappPhoneNumberId && (accessToken || whatsappConfigured)) {
    const withinBudget = await tryConsumeWhatsappTrialBudget(barbershopId, usingSharedToken, templateName);
    if (withinBudget) {
      try {
        await sendWhatsappTemplate(barbershop.whatsappPhoneNumberId, phone, templateName, params, "pt_BR", accessToken);
        return;
      } catch (err) {
        console.error(`[WHATSAPP] Falha ao enviar template "${templateName}", caindo pro stub:`, (err as Error).message);
      }
    } else {
      console.log(`[WHATSAPP] Limite de uso do trial atingido pra "${templateName}" (barbearia ${barbershopId}), pulando envio real.`);
    }
  }
  console.log(`\n[LEMBRETE WHATSAPP - STUB] Para: ${phone}\n${fallbackText}\n`);
}

export async function sendRescheduleNotice(barbershopId: number, appointment: AppointmentDTO) {
  await sendWhatsAppTemplateMessage(
    barbershopId,
    appointment.clientPhone,
    "appointment_reschedule_notice",
    [appointment.clientName, appointment.serviceName, appointment.barberName, appointment.startTime, appointment.date],
    buildRescheduleNoticeText(appointment)
  );
}

export function buildRescheduleNoticeText(appointment: AppointmentDTO): string {
  return (
    `Olá, ${appointment.clientName}! 😥 Precisamos remarcar seu horário de ${appointment.serviceName} ` +
    `com ${appointment.barberName} às ${appointment.startTime} no dia ${appointment.date} por um imprevisto ` +
    `na nossa agenda. Desculpe o transtorno!\n\n` +
    `Poderia responder aqui pra gente já encontrar um novo horário que funcione pra você? 🙏`
  );
}

function comeBackServiceHint(lastAppointment: AppointmentDTO | null): string {
  return lastAppointment
    ? `Que tal já garantir um novo ${lastAppointment.serviceName} com ${lastAppointment.barberName}?`
    : `Que tal já garantir seu próximo horário antes que a agenda fique cheia?`;
}

export function buildComeBackText(clientName: string, barbershopName: string, lastAppointment: AppointmentDTO | null = null): string {
  return (
    `Oi, ${clientName}! 👋 Faz um tempinho que a gente não te vê por aqui na ${barbershopName}... ` +
    `sentimos sua falta! ✂️😄\n\n` +
    `${comeBackServiceHint(lastAppointment)} ` +
    `É só responder aqui que a gente já encaixa você. Esperamos por você! 🙌`
  );
}

// Mensagem de "reconquista" é categoria MARKETING na Meta — exige opt-in
// explícito do cliente (diferente de lembrete/aviso transacional), que é
// checado por quem chama esta função antes de enviar.
export async function sendComeBackMessage(
  barbershopId: number,
  phone: string,
  clientName: string,
  barbershopName: string,
  lastAppointment: AppointmentDTO | null
) {
  await sendWhatsAppTemplateMessage(
    barbershopId,
    phone,
    "come_back_message",
    [clientName, barbershopName, comeBackServiceHint(lastAppointment)],
    buildComeBackText(clientName, barbershopName, lastAppointment)
  );
}

function buildReminderText(appointment: AppointmentDTO): string {
  return (
    `Olá, ${appointment.clientName}! 👋 Passando pra lembrar do seu horário hoje:\n\n` +
    `✂️ ${appointment.serviceName} com ${appointment.barberName}\n` +
    `🕐 ${appointment.startTime}\n` +
    `📍 ${appointment.barbershopName}\n\n` +
    `Te esperamos! Se precisar remarcar, é só responder aqui.`
  );
}

function reminderTemplateParams(appointment: AppointmentDTO): string[] {
  return [appointment.clientName, appointment.serviceName, appointment.barberName, appointment.startTime];
}

export async function checkAndSendReminders() {
  const appointments = await getAppointmentsNeedingReminder();
  for (const appointment of appointments) {
    await sendWhatsAppTemplateMessage(
      appointment.barbershopId,
      appointment.clientPhone,
      "appointment_reminder",
      reminderTemplateParams(appointment),
      buildReminderText(appointment)
    );
    await markReminderSent(appointment.id);
  }
}

// Usado pelo Vercel Cron (roda 1x/dia no plano Hobby): avisa de manhã sobre
// todos os agendamentos de hoje, em vez do lembrete ~1h antes de cada um.
export async function sendDailyReminders() {
  const appointments = await getTodaysAppointmentsForReminder();
  for (const appointment of appointments) {
    await sendWhatsAppTemplateMessage(
      appointment.barbershopId,
      appointment.clientPhone,
      "appointment_reminder",
      reminderTemplateParams(appointment),
      buildReminderText(appointment)
    );
    await markReminderSent(appointment.id);
  }
}

export function startReminderScheduler() {
  checkAndSendReminders();
  setInterval(checkAndSendReminders, CHECK_INTERVAL_MS);
  console.log("Scheduler de lembretes de agendamento iniciado (varredura a cada 1 min).");
}
