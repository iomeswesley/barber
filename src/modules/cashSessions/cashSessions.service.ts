import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/middleware/errorHandler.js";
import { getAppointments } from "@/modules/appointments/appointments.repository.js";
import { computeApptStatus } from "@/modules/dashboard/dashboardStats.service.js";
import { getFinancialAccount } from "@/modules/financialAccounts/financialAccounts.repository.js";
import { localDateStr } from "@/lib/time.js";
import { getOpenSession, createSession, getSession, closeSessionRow, listSessions } from "./cashSessions.repository.js";

// Quanto dinheiro físico deveria ter entrado desde a abertura do caixa —
// soma de agendamentos concluídos + vendas de produto marcados como
// "dinheiro" (Appointment.paymentMethod / ProductSale.paymentMethod), no
// intervalo de datas [openedDateStr, untilDateStr]. Não subtrai despesa nem
// sangria (fora de escopo desta v1 — ver comentário do model CashSession) —
// então "esperado" aqui é só entrada, não saldo líquido.
async function computeCashInflowCents(businessId: number, openedDateStr: string, untilDateStr: string): Promise<number> {
  const now = new Date();
  const appointments = await getAppointments({ businessId, dateFrom: openedDateStr, dateTo: untilDateStr });
  const cashApptCents = appointments
    .filter((a) => a.paymentMethod === "dinheiro" && computeApptStatus(a, now) === "concluido")
    .reduce((sum, a) => sum + a.priceCents, 0);

  const productSales = await prisma.productSale.findMany({
    where: {
      businessId,
      paymentMethod: "dinheiro",
      date: { gte: new Date(`${openedDateStr}T00:00:00`), lte: new Date(`${untilDateStr}T00:00:00`) },
    },
    include: { product: { select: { priceCents: true } } },
  });
  const cashProductCents = productSales.reduce((sum, s) => sum + s.quantity * s.product.priceCents, 0);

  return cashApptCents + cashProductCents;
}

export async function getCashSessionStatus(businessId: number, financialAccountId: number) {
  const account = await getFinancialAccount(financialAccountId);
  if (!account || account.businessId !== businessId) throw new AppError("Conta financeira não encontrada", 404);
  if (account.type !== "caixa") throw new AppError("Só contas do tipo caixa têm abertura/fechamento");

  const open = await getOpenSession(financialAccountId);
  if (!open) return { open: false as const };

  const untilDateStr = localDateStr(new Date());
  const inflowCents = await computeCashInflowCents(businessId, localDateStr(open.openedAt), untilDateStr);
  const expectedNowCents = open.openingBalanceCents + inflowCents;
  return { open: true as const, session: open, expectedNowCents };
}

export async function openCashSession(businessId: number, financialAccountId: number, openingBalanceCents: number, openedBy: string) {
  const account = await getFinancialAccount(financialAccountId);
  if (!account || account.businessId !== businessId) throw new AppError("Conta financeira não encontrada", 404);
  if (account.type !== "caixa") throw new AppError("Só contas do tipo caixa têm abertura/fechamento");

  const alreadyOpen = await getOpenSession(financialAccountId);
  if (alreadyOpen) throw new AppError("Já existe um caixa aberto pra essa conta — feche antes de abrir outro");

  return createSession({ businessId, financialAccountId, openingBalanceCents, openedBy });
}

export async function closeCashSession(businessId: number, id: number, closingBalanceCents: number, closedBy: string, note?: string) {
  const session = await getSession(id);
  if (!session || session.businessId !== businessId) throw new AppError("Sessão de caixa não encontrada", 404);
  if (session.closedAt) throw new AppError("Este caixa já foi fechado");

  const untilDateStr = localDateStr(new Date());
  const inflowCents = await computeCashInflowCents(businessId, localDateStr(session.openedAt), untilDateStr);
  const expectedClosingCents = session.openingBalanceCents + inflowCents;

  return closeSessionRow(id, { closingBalanceCents, expectedClosingCents, closedBy, note });
}

export { listSessions };
