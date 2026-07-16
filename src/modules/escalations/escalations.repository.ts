import { prisma } from "@/lib/prisma.js";

export function createEscalation(barbershopId: number, { clientId, clientPhone, reason }: { clientId?: number | null; clientPhone: string; reason: string }) {
  return prisma.escalation.create({
    data: { barbershopId, clientId: clientId || null, clientPhone, reason },
  });
}

export function listEscalations(barbershopId: number, { includeResolved = false } = {}) {
  return prisma.escalation.findMany({
    where: { barbershopId, ...(includeResolved ? {} : { resolved: false }) },
    include: { client: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function countUnresolvedEscalations(barbershopId: number): Promise<number> {
  return prisma.escalation.count({ where: { barbershopId, resolved: false } });
}

export function resolveEscalation(id: number) {
  return prisma.escalation.update({ where: { id }, data: { resolved: true } });
}

export function getEscalationById(id: number) {
  return prisma.escalation.findUnique({ where: { id } });
}
