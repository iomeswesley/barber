import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { prisma } from "@/lib/prisma.js";
import { hashPassword } from "@/lib/auth.js";
import { resolveChargedPrice, confirmPhoneVerification, assertPhoneVerifiedRecently } from "./clientPlans.service.js";

// Teste de integração: usa o banco real. Cobre a lógica de consumo dos 3
// tipos de benefício de ClientPlan, e o fluxo de verificação de telefone —
// sem chamar startPhoneVerification (dispararia envio real de WhatsApp),
// a linha de PhoneVerification é semeada direto no banco.
describe("resolveChargedPrice", () => {
  let shop: { id: number };
  let client: { id: number };
  let service: { id: number; priceCents: number };
  let planIncluded: { id: number };
  let planDiscount: { id: number };
  let planUnlimited: { id: number };

  beforeAll(async () => {
    shop = await prisma.barbershop.create({ data: { name: "[teste] Plan Consumo" } });
    client = await prisma.client.create({ data: { name: "[teste] Cliente Plano", phone: `teste-plan-${Date.now()}` } });
    service = await prisma.service.create({
      data: { barbershopId: shop.id, name: "[teste] Corte", priceCents: 5000, durationMin: 30 },
    });
    planIncluded = await prisma.clientPlan.create({
      data: { barbershopId: shop.id, name: "[teste] Incluído", priceCents: 9900, benefitType: "services_included", benefitValue: 1 },
    });
    planDiscount = await prisma.clientPlan.create({
      data: { barbershopId: shop.id, name: "[teste] Desconto", priceCents: 4900, benefitType: "percent_discount", benefitValue: 20 },
    });
    planUnlimited = await prisma.clientPlan.create({
      data: {
        barbershopId: shop.id,
        name: "[teste] Ilimitado",
        priceCents: 14900,
        benefitType: "unlimited_service",
        benefitValue: 1,
        serviceId: service.id,
      },
    });
  });

  afterAll(async () => {
    await prisma.clientPlanSubscription.deleteMany({ where: { barbershopId: shop.id } });
    await prisma.clientPlan.deleteMany({ where: { barbershopId: shop.id } });
    await prisma.service.deleteMany({ where: { id: service.id } });
    await prisma.client.deleteMany({ where: { id: client.id } });
    await prisma.barbershop.deleteMany({ where: { id: shop.id } });
  });

  it("sem assinatura ativa, retorna preço de tabela (null)", async () => {
    const result = await resolveChargedPrice(client.id, shop.id, service.id, service.priceCents);
    expect(result).toEqual({ priceChargedCents: null, subscriptionId: null, creditConsumed: false });
  });

  it("unlimited_service: preço 0 sem consumir cota", async () => {
    const sub = await prisma.clientPlanSubscription.create({
      data: { barbershopId: shop.id, clientId: client.id, clientPlanId: planUnlimited.id, status: "active" },
    });
    const result = await resolveChargedPrice(client.id, shop.id, service.id, service.priceCents);
    expect(result.priceChargedCents).toBe(0);
    expect(result.creditConsumed).toBe(false);
    await prisma.clientPlanSubscription.delete({ where: { id: sub.id } });
  });

  it("services_included: consome a cota até esgotar, depois cai pro preço cheio", async () => {
    const sub = await prisma.clientPlanSubscription.create({
      data: { barbershopId: shop.id, clientId: client.id, clientPlanId: planIncluded.id, status: "active" },
    });
    const first = await resolveChargedPrice(client.id, shop.id, service.id, service.priceCents);
    expect(first.priceChargedCents).toBe(0);
    expect(first.creditConsumed).toBe(true);

    const second = await resolveChargedPrice(client.id, shop.id, service.id, service.priceCents);
    expect(second.priceChargedCents).toBeNull(); // benefitValue=1, já consumido, sem outro plano aplicável

    await prisma.clientPlanSubscription.delete({ where: { id: sub.id } });
  });

  it("percent_discount: aplica o desconto sobre o preço de tabela", async () => {
    const sub = await prisma.clientPlanSubscription.create({
      data: { barbershopId: shop.id, clientId: client.id, clientPlanId: planDiscount.id, status: "active" },
    });
    const result = await resolveChargedPrice(client.id, shop.id, service.id, service.priceCents);
    expect(result.priceChargedCents).toBe(4000); // 5000 * (1 - 0.20)
    await prisma.clientPlanSubscription.delete({ where: { id: sub.id } });
  });
});

describe("verificação de telefone (confirmPhoneVerification / assertPhoneVerifiedRecently)", () => {
  afterEach(async () => {
    await prisma.phoneVerification.deleteMany({ where: { phone: { startsWith: "teste-otp-" } } });
  });

  it("código correto verifica com sucesso", async () => {
    const phone = `teste-otp-${Date.now()}-a`;
    await prisma.phoneVerification.create({
      data: { phone, codeHash: hashPassword("123456"), expiresAt: new Date(Date.now() + 60_000) },
    });
    await confirmPhoneVerification(phone, "123456");
    await expect(assertPhoneVerifiedRecently(phone)).resolves.toBeUndefined();
  });

  it("código errado rejeita e incrementa tentativas", async () => {
    const phone = `teste-otp-${Date.now()}-b`;
    await prisma.phoneVerification.create({
      data: { phone, codeHash: hashPassword("123456"), expiresAt: new Date(Date.now() + 60_000) },
    });
    await expect(confirmPhoneVerification(phone, "000000")).rejects.toThrow("Código incorreto");
    const row = await prisma.phoneVerification.findUnique({ where: { phone } });
    expect(row?.attempts).toBe(1);
  });

  it("código expirado rejeita", async () => {
    const phone = `teste-otp-${Date.now()}-c`;
    await prisma.phoneVerification.create({
      data: { phone, codeHash: hashPassword("123456"), expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(confirmPhoneVerification(phone, "123456")).rejects.toThrow("expirado");
  });

  it("sem verificação recente, assertPhoneVerifiedRecently rejeita", async () => {
    const phone = `teste-otp-${Date.now()}-d`;
    await expect(assertPhoneVerifiedRecently(phone)).rejects.toThrow("Verifique seu telefone");
  });
});
