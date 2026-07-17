import webPush from "web-push";
import { env } from "@/config/env.js";
import { getPushSubscriptionsForShop, deletePushSubscriptionById } from "./push.repository.js";
import type { AppointmentDTO } from "@/modules/appointments/appointments.types.js";

const vapidReady = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

if (vapidReady) {
  webPush.setVapidDetails(
    env.VAPID_SUBJECT || "mailto:admin@barbearia.com",
    env.VAPID_PUBLIC_KEY!,
    env.VAPID_PRIVATE_KEY!
  );
} else {
  console.warn("[PUSH] VAPID keys não configuradas — notificações push desativadas.");
}

export const VAPID_PUBLIC = env.VAPID_PUBLIC_KEY || "";

// Dispara notificação push para todos os usuários cadastrados de uma
// barbearia. Subscriptions inválidas (expiradas, revogadas) são removidas
// automaticamente.
async function notifyShop(barbershopId: number, payload: { title: string; body: string; url: string }) {
  if (!vapidReady) return;

  const subscriptions = await getPushSubscriptionsForShop(barbershopId);
  if (!subscriptions.length) return;

  const json = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webPush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, json)
    )
  );

  results.forEach((result, i) => {
    if (result.status === "rejected") {
      const status = (result.reason as { statusCode?: number })?.statusCode;
      if (status === 410 || status === 404) {
        deletePushSubscriptionById(subscriptions[i]!.id);
      } else {
        console.error("[PUSH] Erro ao enviar notificação:", (result.reason as Error)?.message);
      }
    }
  });
}

export function notifyNewAppointment(barbershopId: number, appointment: AppointmentDTO) {
  return notifyShop(barbershopId, {
    title: "📅 Novo agendamento!",
    body: `${appointment.clientName} — ${appointment.serviceName} com ${appointment.barberName} em ${appointment.date} às ${appointment.startTime}`,
    url: "/admin.html",
  });
}

// Reclamação séria ou emergência escalada pelo bot de chat — diferente de um
// novo agendamento, isso pode precisar de resposta rápida da equipe, então
// vale um aviso proativo em vez de só aparecer na aba de Escalações do painel.
export function notifyEscalation(barbershopId: number, clientName: string | null, reason: string) {
  return notifyShop(barbershopId, {
    title: "🚨 Cliente precisa de atendimento humano",
    body: `${clientName || "Cliente"}: ${reason}`,
    url: "/admin.html",
  });
}
