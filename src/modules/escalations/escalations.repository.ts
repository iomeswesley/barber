import { prisma } from "@/lib/prisma.js";

export function createEscalation(businessId: number, { clientId, clientPhone, reason }: { clientId?: number | null; clientPhone: string; reason: string }) {
  return prisma.escalation.create({
    data: { businessId, clientId: clientId || null, clientPhone, reason },
  });
}

export function listEscalations(businessId: number, { includeResolved = false } = {}) {
  return prisma.escalation.findMany({
    where: { businessId, ...(includeResolved ? {} : { resolved: false }) },
    include: { client: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function countUnresolvedEscalations(businessId: number): Promise<number> {
  return prisma.escalation.count({ where: { businessId, resolved: false } });
}

export function resolveEscalation(id: number) {
  return prisma.escalation.update({ where: { id }, data: { resolved: true } });
}

export function getEscalationById(id: number) {
  return prisma.escalation.findUnique({ where: { id } });
}
