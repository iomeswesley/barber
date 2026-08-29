import { prisma } from "@/lib/prisma.js";
import { getAppointments } from "@/modules/appointments/appointments.repository.js";
import { getProductSalesWithAppointment } from "@/modules/products/products.repository.js";
import { getBarber } from "@/modules/professionals/professionals.repository.js";
import { computeApptStatus } from "@/modules/dashboard/dashboardStats.service.js";

// Comissão devida no período [dateFrom, dateTo] (inclusive, "YYYY-MM-DD") pra
// um profissional — mesma regra do dashboard (dashboardStats.service.ts):
// só agendamentos concluídos contam (nunca cancelado/no-show/futuro), e
// comissão de produto só é devida sobre venda vinculada a um agendamento
// desse profissional (venda avulsa no balcão não gera comissão pra ninguém).
// Reimplementada aqui em vez de importada do dashboard porque o dashboard
// calcula "mês corrente" pra todos os profissionais de uma vez só; aqui
// precisamos de um profissional + período arbitrário (o período fechado nem
// sempre é o mês corrente, ex: fechamento atrasado do mês passado).
export async function computeCommissionForPeriod(businessId: number, professionalId: number, dateFrom: string, dateTo: string) {
  const barber = await getBarber(professionalId);
  if (!barber || barber.businessId !== businessId) {
    throw new Error("Profissional não encontrado nesta conta.");
  }

  const now = new Date();
  const appointments = (await getAppointments({ businessId, professionalId, dateFrom, dateTo })).filter(
    (a) => computeApptStatus(a, now) === "concluido"
  );
  const serviceRevenueCents = appointments.reduce((sum, a) => sum + a.priceCents, 0);
  const serviceCommissionCents = Math.round((serviceRevenueCents * Number(barber.serviceCommissionPercent)) / 100);

  const appointmentIds = new Set(appointments.map((a) => a.id));
  const productSales = await getProductSalesWithAppointment(businessId, { dateFrom, dateTo });
  const productRevenueCents = productSales
    .filter((s) => appointmentIds.has(s.appointmentId))
    .reduce((sum, s) => sum + s.amountCents, 0);
  const productCommissionCents = Math.round((productRevenueCents * Number(barber.productCommissionPercent)) / 100);

  return {
    professionalId,
    professionalName: barber.name,
    serviceRevenueCents,
    serviceCommissionCents,
    productRevenueCents,
    productCommissionCents,
    totalCommissionCents: serviceCommissionCents + productCommissionCents,
  };
}

// Já existe um fechamento (aberto ou pago) que cobre esse período pra esse
// profissional? Comparação por sobreposição de intervalo, não igualdade
// exata, pra pegar também o caso de fechar duas vezes um período que se
// cruza parcialmente (ex: fechar 01-15 e depois tentar fechar 10-20).
export function findOverlappingPayout(professionalId: number, periodStart: string, periodEnd: string) {
  return prisma.professionalPayout.findFirst({
    where: {
      professionalId,
      periodStart: { lte: new Date(periodEnd) },
      periodEnd: { gte: new Date(periodStart) },
    },
  });
}

export function createPayout(data: {
  businessId: number;
  professionalId: number;
  periodStart: string;
  periodEnd: string;
  serviceCommissionCents: number;
  productCommissionCents: number;
  createdBy: string;
}) {
  return prisma.professionalPayout.create({
    data: {
      businessId: data.businessId,
      professionalId: data.professionalId,
      periodStart: new Date(data.periodStart),
      periodEnd: new Date(data.periodEnd),
      serviceCommissionCents: data.serviceCommissionCents,
      productCommissionCents: data.productCommissionCents,
      createdBy: data.createdBy,
    },
  });
}

export function getPayout(id: number) {
  return prisma.professionalPayout.findUnique({ where: { id }, include: { professional: { select: { name: true } } } });
}

export function listPayouts(businessId: number, { professionalId }: { professionalId?: number } = {}) {
  return prisma.professionalPayout.findMany({
    where: { businessId, ...(professionalId ? { professionalId } : {}) },
    include: { professional: { select: { name: true } } },
    orderBy: { periodStart: "desc" },
  });
}

export function markPayoutPaid(
  id: number,
  { adjustmentCents = 0, adjustmentReason, note }: { adjustmentCents?: number; adjustmentReason?: string | null; note?: string | null }
) {
  return prisma.professionalPayout.update({
    where: { id },
    data: {
      status: "paid",
      paidAt: new Date(),
      adjustmentCents,
      adjustmentReason: adjustmentReason || null,
      note: note || null,
    },
  });
}

export function deleteOpenPayout(id: number) {
  return prisma.professionalPayout.deleteMany({ where: { id, status: "open" } });
}
