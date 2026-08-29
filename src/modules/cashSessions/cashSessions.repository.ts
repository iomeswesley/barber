import { prisma } from "@/lib/prisma.js";

const includeAccount = { financialAccount: { select: { name: true, type: true } } } as const;

export function getOpenSession(financialAccountId: number) {
  return prisma.cashSession.findFirst({ where: { financialAccountId, closedAt: null }, include: includeAccount });
}

export function getSession(id: number) {
  return prisma.cashSession.findUnique({ where: { id }, include: includeAccount });
}

export function listSessions(businessId: number, { financialAccountId }: { financialAccountId?: number } = {}) {
  return prisma.cashSession.findMany({
    where: { businessId, ...(financialAccountId ? { financialAccountId } : {}) },
    include: includeAccount,
    orderBy: { openedAt: "desc" },
    take: 50,
  });
}

export function createSession(data: { businessId: number; financialAccountId: number; openingBalanceCents: number; openedBy: string }) {
  return prisma.cashSession.create({ data, include: includeAccount });
}

export function closeSessionRow(
  id: number,
  data: { closingBalanceCents: number; expectedClosingCents: number; closedBy: string; note?: string | null }
) {
  return prisma.cashSession.update({
    where: { id },
    data: {
      closedAt: new Date(),
      closingBalanceCents: data.closingBalanceCents,
      expectedClosingCents: data.expectedClosingCents,
      closedBy: data.closedBy,
      note: data.note || null,
    },
    include: includeAccount,
  });
}
