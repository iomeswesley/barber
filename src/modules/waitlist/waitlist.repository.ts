import { prisma } from "@/lib/prisma.js";

const includeNames = {
  client: { select: { name: true, phone: true } },
  professional: { select: { name: true } },
  service: { select: { name: true } },
} as const;

export function createWaitlistEntry(
  businessId: number,
  data: { clientId: number; professionalId?: number | null; serviceId?: number | null; desiredDateStart: string; desiredDateEnd: string }
) {
  return prisma.waitlistEntry.create({
    data: {
      businessId,
      clientId: data.clientId,
      professionalId: data.professionalId || null,
      serviceId: data.serviceId || null,
      desiredDateStart: new Date(`${data.desiredDateStart}T00:00:00`),
      desiredDateEnd: new Date(`${data.desiredDateEnd}T00:00:00`),
    },
  });
}

export function listWaitlist(businessId: number, { status }: { status?: string } = {}) {
  return prisma.waitlistEntry.findMany({
    where: { businessId, ...(status ? { status: status as any } : {}) },
    include: includeNames,
    orderBy: { createdAt: "desc" },
  });
}

export function getWaitlistEntry(id: number) {
  return prisma.waitlistEntry.findUnique({ where: { id }, include: includeNames });
}

// Quem está esperando um horário que acabou de abrir — usada logo depois de
// um cancelamento (ver notifyWaitlistForFreedSlot em waitlist.service.ts).
// professionalId/serviceId nulos na entrada = cliente aceita qualquer
// profissional/serviço, então casam com qualquer slot liberado.
export function findMatchingWaitlistEntries(businessId: number, professionalId: number, serviceId: number, date: string) {
  const d = new Date(`${date}T00:00:00`);
  return prisma.waitlistEntry.findMany({
    where: {
      businessId,
      status: "aguardando",
      desiredDateStart: { lte: d },
      desiredDateEnd: { gte: d },
      OR: [{ professionalId: null }, { professionalId }],
      AND: [{ OR: [{ serviceId: null }, { serviceId }] }],
    },
    include: includeNames,
  });
}

export function markWaitlistNotified(id: number) {
  return prisma.waitlistEntry.update({ where: { id }, data: { status: "notificado", notifiedAt: new Date() } });
}

export function cancelWaitlistEntry(id: number) {
  return prisma.waitlistEntry.update({ where: { id }, data: { status: "expirado" } });
}
