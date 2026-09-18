import { prisma } from "@/lib/prisma.js";
import { dateOnly } from "@/lib/time.js";

export function getExpenses(businessId: number, { status }: { status?: "open" | "paid" } = {}) {
  return prisma.expense.findMany({
    where: { businessId, ...(status ? { status } : {}) },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
  });
}

export function getExpense(id: number) {
  return prisma.expense.findUnique({ where: { id } });
}

export function createExpense(
  businessId: number,
  data: { description: string; amountCents: number; dueDate: string; category?: string | null }
) {
  return prisma.expense.create({
    data: {
      businessId,
      description: data.description,
      amountCents: data.amountCents,
      dueDate: dateOnly(data.dueDate),
      category: data.category || null,
    },
  });
}

export function updateExpense(
  id: number,
  data: { description: string; amountCents: number; dueDate: string; category?: string | null }
) {
  return prisma.expense.update({
    where: { id },
    data: {
      description: data.description,
      amountCents: data.amountCents,
      dueDate: dateOnly(data.dueDate),
      category: data.category || null,
    },
  });
}

export function markExpensePaid(id: number, paid: boolean) {
  return prisma.expense.update({ where: { id }, data: { status: paid ? "paid" : "open", paidAt: paid ? new Date() : null } });
}

export function deleteExpense(id: number) {
  return prisma.expense.delete({ where: { id } });
}
