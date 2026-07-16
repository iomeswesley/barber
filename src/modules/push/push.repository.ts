import { prisma } from "@/lib/prisma.js";

export function savePushSubscription(
  barbershopId: number,
  userId: number,
  { endpoint, p256dh, auth }: { endpoint: string; p256dh: string; auth: string }
) {
  return prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { p256dh, auth, userId, barbershopId },
    create: { barbershopId, userId, endpoint, p256dh, auth },
  });
}

export function deletePushSubscriptionByEndpoint(endpoint: string) {
  return prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

export function deletePushSubscriptionById(id: number) {
  return prisma.pushSubscription.delete({ where: { id } });
}

export function getPushSubscriptionsForShop(barbershopId: number) {
  return prisma.pushSubscription.findMany({ where: { barbershopId } });
}
