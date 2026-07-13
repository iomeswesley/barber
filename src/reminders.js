import { getAppointmentsNeedingReminder, markReminderSent } from "./db.js";

const CHECK_INTERVAL_MS = 60 * 1000; // varre a cada minuto

/**
 * Stub de envio — ainda não há uma integração real com WhatsApp conectada
 * (Cloud API da Meta ou whatsapp-web.js). Quando essa integração existir,
 * troque o corpo desta função para chamar o envio de mensagem de verdade;
 * o resto do sistema de lembretes (detecção da janela de 1h, deduplicação
 * via reminder_sent_at) já funciona de ponta a ponta.
 */
export function sendWhatsAppMessage(phone, text) {
  console.log(`\n[LEMBRETE WHATSAPP - STUB] Para: ${phone}\n${text}\n`);
}

export function buildRescheduleNoticeText(appointment) {
  return (
    `Olá, ${appointment.client_name}! 😥 Precisamos remarcar seu horário de ${appointment.service_name} ` +
    `com ${appointment.barber_name} às ${appointment.start_time} no dia ${appointment.date} por um imprevisto ` +
    `na nossa agenda. Desculpe o transtorno!\n\n` +
    `Poderia responder aqui pra gente já encontrar um novo horário que funcione pra você? 🙏`
  );
}

export function buildComeBackText(clientName, barbershopName) {
  return (
    `Oi, ${clientName}! 👋 Faz um tempinho que a gente não te vê por aqui na ${barbershopName}... ` +
    `sentimos sua falta! ✂️😄\n\n` +
    `Que tal já garantir seu próximo horário antes que a agenda fique cheia? ` +
    `É só responder aqui que a gente já encaixa você. Esperamos por você! 🙌`
  );
}

function buildReminderText(appointment) {
  return (
    `Olá, ${appointment.client_name}! 👋 Passando pra lembrar do seu horário hoje:\n\n` +
    `✂️ ${appointment.service_name} com ${appointment.barber_name}\n` +
    `🕐 ${appointment.start_time}\n` +
    `📍 ${appointment.barbershop_name}\n\n` +
    `Te esperamos! Se precisar remarcar, é só responder aqui.`
  );
}

function checkAndSendReminders() {
  const appointments = getAppointmentsNeedingReminder();
  for (const appointment of appointments) {
    sendWhatsAppMessage(appointment.client_phone, buildReminderText(appointment));
    markReminderSent(appointment.id);
  }
}

export function startReminderScheduler() {
  checkAndSendReminders();
  setInterval(checkAndSendReminders, CHECK_INTERVAL_MS);
  console.log("Scheduler de lembretes de agendamento iniciado (varredura a cada 1 min).");
}
