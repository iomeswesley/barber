import { prisma } from "@/lib/prisma.js";

export function getFinancialAccounts(businessId: number, { includeInactive = false } = {}) {
  return prisma.financialAccount.findMany({
    where: { businessId, ...(includeInactive ? {} : { active: true }) },
    orderBy: { id: "asc" },
  });
}

export function getFinancialAccount(id: number) {
  return prisma.financialAccount.findUnique({ where: { id } });
}

export function createFinancialAccount(businessId: number, data: { name: string; type: "caixa" | "banco" }) {
  return prisma.financialAccount.create({ data: { businessId, name: data.name, type: data.type } });
}

export function setFinancialAccountActive(id: number, active: boolean) {
  return prisma.financialAccount.update({ where: { id }, data: { active } });
}
