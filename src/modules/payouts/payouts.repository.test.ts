import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma.js";
import {
  computeCommissionForPeriod,
  findOverlappingPayout,
  createPayout,
  markPayoutPaid,
  deleteOpenPayout,
  listPayouts,
} from "./payouts.repository.js";

// Teste de integração: banco real, dados prefixados com "[teste]" e limpos no
// afterAll (mesmo padrão de appointments.service.test.ts). Cobre a regra de
// negócio que mais importa aqui: o valor calculado bater com comissão de
// serviço + produto, e o fechamento não deixar fechar duas vezes o mesmo período.
describe("payouts.repository (fechamento e pagamento de comissão)", () => {
  let business: { id: number };
  let barber: { id: number };
  let service: { id: number };
  let client: { id: number };
  let product: { id: number };
  let appointment: { id: number };

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dateStr = yesterday.toISOString().slice(0, 10);

  beforeAll(async () => {
    business = await prisma.business.create({ data: { name: "[teste] Payouts Shop" } });
    barber = await prisma.professional.create({
      data: { businessId: business.id, name: "[teste] Barbeiro Payout", serviceCommissionPercent: 50, productCommissionPercent: 20 },
    });
    service = await prisma.service.create({ data: { businessId: business.id, name: "[teste] Corte", priceCents: 10000, durationMin: 30 } });
    client = await prisma.client.create({ data: { name: "[teste] Cliente Payout", phone: `teste-payout-${Date.now()}` } });
    product = await prisma.product.create({ data: { businessId: business.id, name: "[teste] Pomada", priceCents: 2000, stockQuantity: 10 } });

    // Agendamento já concluído (ontem, horário no passado) — status "confirmed"
    // pra ficar fora do fluxo de confirmação, mas dentro de "concluído" pro
    // cálculo (computeApptStatus só olha data/hora + não ser no_show/cancelled).
    appointment = await prisma.appointment.create({
      data: {
        businessId: business.id,
        professionalId: barber.id,
        serviceId: service.id,
        clientId: client.id,
        date: yesterday,
        startTime: "10:00",
        endTime: "10:30",
        status: "confirmed",
      },
    });
    await prisma.productSale.create({
      data: { businessId: business.id, clientId: client.id, productId: product.id, quantity: 1, date: yesterday, appointmentId: appointment.id },
    });
  });

  afterAll(async () => {
    await prisma.professionalPayout.deleteMany({ where: { businessId: business.id } });
    await prisma.productSale.deleteMany({ where: { businessId: business.id } });
    await prisma.appointment.deleteMany({ where: { businessId: business.id } });
    await prisma.product.deleteMany({ where: { id: product.id } });
    await prisma.client.deleteMany({ where: { id: client.id } });
    await prisma.service.deleteMany({ where: { id: service.id } });
    await prisma.professional.deleteMany({ where: { id: barber.id } });
    await prisma.business.deleteMany({ where: { id: business.id } });
  });

  it("calcula comissão de serviço (50% de R$100) e produto (20% de R$20) no período", async () => {
    const result = await computeCommissionForPeriod(business.id, barber.id, dateStr, dateStr);
    expect(result.serviceRevenueCents).toBe(10000);
    expect(result.serviceCommissionCents).toBe(5000);
    expect(result.productRevenueCents).toBe(2000);
    expect(result.productCommissionCents).toBe(400);
    expect(result.totalCommissionCents).toBe(5400);
  });

  it("não conta nada fora do período pedido", async () => {
    const result = await computeCommissionForPeriod(business.id, barber.id, "2099-01-01", "2099-01-31");
    expect(result.totalCommissionCents).toBe(0);
  });

  it("fechar → não deixa fechar de novo o mesmo período → marcar como pago", async () => {
    expect(await findOverlappingPayout(barber.id, dateStr, dateStr)).toBeNull();

    const payout = await createPayout({
      businessId: business.id,
      professionalId: barber.id,
      periodStart: dateStr,
      periodEnd: dateStr,
      serviceCommissionCents: 5000,
      productCommissionCents: 400,
      createdBy: "[teste] dono",
    });
    expect(payout.status).toBe("open");

    // Período que se sobrepõe (mesmo dia) já não pode ser fechado de novo.
    expect(await findOverlappingPayout(barber.id, dateStr, dateStr)).not.toBeNull();

    const paid = await markPayoutPaid(payout.id, { adjustmentCents: -100, adjustmentReason: "[teste] desconto combinado" });
    expect(paid.status).toBe("paid");
    expect(paid.adjustmentCents).toBe(-100);
    expect(paid.paidAt).not.toBeNull();

    const history = await listPayouts(business.id, { professionalId: barber.id });
    expect(history.map((p) => p.id)).toContain(payout.id);

    // Já pago não pode mais ser excluído (deleteOpenPayout só apaga status "open").
    const deleted = await deleteOpenPayout(payout.id);
    expect(deleted.count).toBe(0);
  });
});
