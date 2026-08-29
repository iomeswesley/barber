import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma.js";
import { createFinancialAccount } from "@/modules/financialAccounts/financialAccounts.repository.js";
import { openCashSession, closeCashSession, getCashSessionStatus } from "./cashSessions.service.js";
import { localDateStr } from "@/lib/time.js";

// Teste de integração: banco real, dados "[teste]". Cobre a regra de negócio
// central — "esperado" soma só o que foi marcado como dinheiro (agendamento
// concluído + venda de produto), ignora pix/cartão, e o fechamento congela a
// diferença entre o valor contado e o esperado.
describe("cashSessions (abertura/fechamento de caixa)", () => {
  let business: { id: number };
  let barber: { id: number };
  let service: { id: number };
  let client: { id: number };
  let product: { id: number };
  let account: { id: number };

  const today = localDateStr(new Date());
  // Horário já passado hoje (o cálculo de "esperado" só conta agendamento já
  // concluído dentro do dia em que o caixa foi aberto — uma data de ontem
  // ficaria fora da janela [dia da abertura, hoje] e nunca contaria).
  function pastTimeToday() {
    const d = new Date(Date.now() - 5 * 60 * 1000);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  beforeAll(async () => {
    business = await prisma.business.create({ data: { name: "[teste] Caixa Shop" } });
    barber = await prisma.professional.create({ data: { businessId: business.id, name: "[teste] Barbeiro Caixa" } });
    service = await prisma.service.create({ data: { businessId: business.id, name: "[teste] Corte Caixa", priceCents: 5000, durationMin: 30 } });
    client = await prisma.client.create({ data: { name: "[teste] Cliente Caixa", phone: `teste-caixa-${Date.now()}` } });
    product = await prisma.product.create({ data: { businessId: business.id, name: "[teste] Produto Caixa", priceCents: 3000, stockQuantity: 20 } });
    account = await createFinancialAccount(business.id, { name: "[teste] Caixa Loja", type: "caixa" });
  });

  afterAll(async () => {
    await prisma.cashSession.deleteMany({ where: { businessId: business.id } });
    await prisma.financialAccount.deleteMany({ where: { businessId: business.id } });
    await prisma.productSale.deleteMany({ where: { businessId: business.id } });
    await prisma.appointment.deleteMany({ where: { businessId: business.id } });
    await prisma.product.deleteMany({ where: { id: product.id } });
    await prisma.client.deleteMany({ where: { id: client.id } });
    await prisma.service.deleteMany({ where: { id: service.id } });
    await prisma.professional.deleteMany({ where: { id: barber.id } });
    await prisma.business.deleteMany({ where: { id: business.id } });
  });

  it("não deixa abrir dois caixas ao mesmo tempo pra mesma conta", async () => {
    const session = await openCashSession(business.id, account.id, 10000, "[teste] dono");
    expect(session.openingBalanceCents).toBe(10000);

    await expect(openCashSession(business.id, account.id, 5000, "[teste] dono")).rejects.toThrow("Já existe um caixa aberto");

    // fecha pra não atrapalhar os próximos testes
    await closeCashSession(business.id, session.id, 10000, "[teste] dono");
  });

  it("soma só dinheiro (ignora pix/cartão) e ignora agendamento futuro/não concluído", async () => {
    const session = await openCashSession(business.id, account.id, 20000, "[teste] dono");

    const t = pastTimeToday();
    // concluído (passado hoje), dinheiro — CONTA
    await prisma.appointment.create({
      data: {
        businessId: business.id, professionalId: barber.id, serviceId: service.id, clientId: client.id,
        date: new Date(`${today}T00:00:00`), startTime: t, endTime: t, status: "confirmed", paymentMethod: "dinheiro",
      },
    });
    // concluído, pix — NÃO conta
    await prisma.appointment.create({
      data: {
        businessId: business.id, professionalId: barber.id, serviceId: service.id, clientId: client.id,
        date: new Date(`${today}T00:00:00`), startTime: t, endTime: t, status: "confirmed", paymentMethod: "pix",
      },
    });
    // futuro, dinheiro — NÃO conta (ainda não aconteceu)
    await prisma.appointment.create({
      data: {
        businessId: business.id, professionalId: barber.id, serviceId: service.id, clientId: client.id,
        date: new Date("2099-01-01T00:00:00"), startTime: "09:00", endTime: "09:30", status: "confirmed", paymentMethod: "dinheiro",
      },
    });
    // venda de produto em dinheiro — CONTA
    await prisma.productSale.create({
      data: { businessId: business.id, clientId: client.id, productId: product.id, quantity: 2, date: new Date(`${today}T00:00:00`), paymentMethod: "dinheiro" },
    });
    // venda de produto em cartão — NÃO conta
    await prisma.productSale.create({
      data: { businessId: business.id, clientId: client.id, productId: product.id, quantity: 1, date: new Date(`${today}T00:00:00`), paymentMethod: "cartao" },
    });

    const status = await getCashSessionStatus(business.id, account.id);
    expect(status.open).toBe(true);
    if (status.open) {
      // 20000 abertura + 5000 (agendamento dinheiro) + 6000 (2x produto R$30) = 31000
      expect(status.expectedNowCents).toBe(31000);
    }

    const closed = await closeCashSession(business.id, session.id, 31500, "[teste] dono", "[teste] sobrou um pouco");
    expect(closed.expectedClosingCents).toBe(31000);
    expect(closed.closingBalanceCents).toBe(31500);
  });

  it("não deixa fechar um caixa já fechado", async () => {
    const session = await openCashSession(business.id, account.id, 1000, "[teste] dono");
    await closeCashSession(business.id, session.id, 1000, "[teste] dono");
    await expect(closeCashSession(business.id, session.id, 1000, "[teste] dono")).rejects.toThrow("já foi fechado");
  });
});
