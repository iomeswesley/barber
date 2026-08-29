import { findMatchingWaitlistEntries, markWaitlistNotified } from "./waitlist.repository.js";
import { getBarbershop } from "@/modules/businesses/businesses.repository.js";
import { sendWhatsappText, whatsappConfigured, resolveBarbershopAccessToken } from "@/lib/whatsapp.js";
import { vertical } from "@/config/env.js";

// Mesmo stub-fallback de sendWhatsAppMessage (src/jobs/reminders.ts) —
// reimplementado aqui em vez de importado de lá pra não criar dependência
// circular (jobs/reminders.ts importa de appointments.service.ts, que passa
// a importar deste módulo pra notificar a lista de espera no cancelamento).
async function sendFreeTextMessage(businessId: number, phone: string, text: string) {
  const barbershop = await getBarbershop(businessId);
  const accessToken = resolveBarbershopAccessToken(barbershop);
  if (barbershop?.whatsappPhoneNumberId && (accessToken || whatsappConfigured)) {
    try {
      await sendWhatsappText(barbershop.whatsappPhoneNumberId, phone, text, accessToken);
      return;
    } catch (err) {
      console.error(`[WAITLIST] Falha ao enviar mensagem real, caindo pro stub:`, (err as Error).message);
    }
  }
  console.log(`\n[LISTA DE ESPERA WHATSAPP - STUB] Para: ${phone}\n${text}\n`);
}

// Chamado depois de um agendamento ser cancelado (ver appointments.service.ts)
// — avisa todo mundo na lista de espera cujo período aceito cobre esse dia e
// que pediu esse profissional/serviço (ou "qualquer um"). Manda texto livre,
// não Message Template: só chega de verdade se o cliente tiver falado com o
// bot nas últimas 24h (janela do WhatsApp — mensagem livre fora disso a Cloud API rejeita),
// o que costuma ser o caso de quem acabou de entrar na lista de espera.
// Pedir um Message Template dedicado aprovado pela Meta é o próximo passo
// pra cobrir também quem entrou há mais tempo — fora do que dá pra fazer só
// em código nesta passada.
export async function notifyWaitlistForFreedSlot(
  businessId: number,
  professionalId: number,
  serviceId: number,
  date: string,
  startTime: string
) {
  const matches = await findMatchingWaitlistEntries(businessId, professionalId, serviceId, date);
  for (const entry of matches) {
    const text = `Boa notícia! Abriu um horário com ${entry.professional?.name ?? "a gente"} no dia ${date} às ${startTime}${
      entry.service ? ` para ${entry.service.name}` : ""
    }. Quer marcar? É só me responder por aqui 🙂`;
    await sendFreeTextMessage(businessId, entry.client.phone, text);
    await markWaitlistNotified(entry.id);
  }
  return matches.length;
}
