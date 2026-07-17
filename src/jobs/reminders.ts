import { getAppointmentsNeedingReminder, getTodaysAppointmentsForReminder } from "@/modules/appointments/appointments.service.js";
import { markReminderSent } from "@/modules/appointments/appointments.repository.js";
import { getBarbershop } from "@/modules/barbershops/barbershops.repository.js";
import { sendWhatsappText, whatsappConfigured } from "@/lib/whatsapp.js";
import type { AppointmentDTO } from "@/modules/appointments/appointments.types.js";

const CHECK_INTERVAL_MS = 60 * 1000; // varre a cada minuto

// Envia via WhatsApp Cloud API quando a barbearia tem um número configurado
// (whatsappPhoneNumberId) e as credenciais da Meta estão no .env; caso
// contrário cai no stub de sempre (só loga no console), pra continuar
// funcionando em barbearias/ambientes sem WhatsApp real conectado.
export async function sendWhatsAppMessage(barbershopId: number, phone: string, text: string) {
  const barbershop = whatsappConfigured ? await getBarbershop(barbershopId) : null;
  if (barbershop?.whatsappPhoneNumberId) {
    try {
      await sendWhatsappText(barbershop.whatsappPhoneNumberId, phone, text);
      return;
    } catch (err) {
      console.error(`[WHATSAPP] Falha ao enviar mensagem real, caindo pro stub:`, (err as Error).message);
    }
  }
  console.log(`\n[LEMBRETE WHATSAPP - STUB] Para: ${phone}\n${text}\n`);
}

export function buildRescheduleNoticeText(appointment: AppointmentDTO): string {
  return (
    `Olá, ${appointment.clientName}! 😥 Precisamos remarcar seu horário de ${appointment.serviceName} ` +
    `com ${appointment.barberName} às ${appointment.startTime} no dia ${appointment.date} por um imprevisto ` +
    `na nossa agenda. Desculpe o transtorno!\n\n` +
    `Poderia responder aqui pra gente já encontrar um novo horário que funcione pra você? 🙏`
  );
}

export function buildComeBackText(clientName: string, barbershopName: string, lastAppointment: AppointmentDTO | null = null): string {
  const serviceHint = lastAppointment
    ? `Que tal já garantir um novo ${lastAppointment.serviceName} com ${lastAppointment.barberName}? `
    : `Que tal já garantir seu próximo horário antes que a agenda fique cheia? `;
  return (
    `Oi, ${clientName}! 👋 Faz um tempinho que a gente não te vê por aqui na ${barbershopName}... ` +
    `sentimos sua falta! ✂️😄\n\n` +
    `${serviceHint}` +
    `É só responder aqui que a gente já encaixa você. Esperamos por você! 🙌`
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

export async function checkAndSendReminders() {
  const appointments = await getAppointmentsNeedingReminder();
  for (const appointment of appointments) {
    await sendWhatsAppMessage(appointment.barbershopId, appointment.clientPhone, buildReminderText(appointment));
    await markReminderSent(appointment.id);
  }
}

// Usado pelo Vercel Cron (roda 1x/dia no plano Hobby): avisa de manhã sobre
// todos os agendamentos de hoje, em vez do lembrete ~1h antes de cada um.
export async function sendDailyReminders() {
  const appointments = await getTodaysAppointmentsForReminder();
  for (const appointment of appointments) {
    await sendWhatsAppMessage(appointment.barbershopId, appointment.clientPhone, buildReminderText(appointment));
    await markReminderSent(appointment.id);
  }
}

export function startReminderScheduler() {
  checkAndSendReminders();
  setInterval(checkAndSendReminders, CHECK_INTERVAL_MS);
  console.log("Scheduler de lembretes de agendamento iniciado (varredura a cada 1 min).");
}
