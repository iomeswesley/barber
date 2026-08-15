import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma.js";
import {
  getSubscription,
  grantTrial,
  tryConsumeWhatsappTrialBudget,
  expireOverdueTrials,
  assertBarberLimitNotExceeded,
  assertProPlan,
  getBillingOverview,
} from "./billing.service.js";
import { env } from "@/config/env.js";

// Teste de integração: usa o banco real. Não toca no Stripe em nenhum
// momento — cobre só a parte de billing.service.ts que não depende da API
// (grantTrial, orçamento de trial do WhatsApp, expiração de trial vencido e
// os dois guards imperativos de plano), com um prefixo "[teste]" pra ficar
// fácil de identificar/limpar.
describe("billing.service (sem Stripe)", () => {
  let shop: { id: number };

  beforeAll(async () => {
    shop = await prisma.business.create({ data: { name: "[teste] Billing Service" } });
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { businessId: shop.id } });
    await prisma.professional.deleteMany({ where: { businessId: shop.id } });
    await prisma.business.deleteMany({ where: { id: shop.id } });
  });

  it("grantTrial cria a assinatura em trialing quando não existia nenhuma", async () => {
    const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const sub = await grantTrial(shop.id, "pro", trialEndsAt);
    expect(sub.status).toBe("trialing");
    expect(sub.plan).toBe("pro");
    expect(sub.trialEndsAt?.getTime()).toBe(trialEndsAt.getTime());
  });

  it("grantTrial pisa em cima de uma assinatura já existente (upsert)", async () => {
    const trialEndsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const sub = await grantTrial(shop.id, "starter", trialEndsAt);
    expect(sub.plan).toBe("starter");
    const found = await getSubscription(shop.id);
    expect(found?.plan).toBe("starter");
  });

  describe("tryConsumeWhatsappTrialBudget", () => {
    it("sempre libera quando não está usando o token compartilhado, mesmo sem assinatura", async () => {
      const otherShop = await prisma.business.create({ data: { name: "[teste] Billing Sem Sub" } });
      const ok = await tryConsumeWhatsappTrialBudget(otherShop.id, false, "appointment_reminder");
      expect(ok).toBe(true);
      await prisma.business.deleteMany({ where: { id: otherShop.id } });
    });

    it("libera e não consome quando a barbearia não está em trial (plano pago)", async () => {
      await prisma.subscription.update({ where: { businessId: shop.id }, data: { status: "active", whatsappTrialUsagePoints: 0 } });
      const ok = await tryConsumeWhatsappTrialBudget(shop.id, true, "appointment_reminder");
      expect(ok).toBe(true);
      const sub = await getSubscription(shop.id);
      expect(sub?.whatsappTrialUsagePoints).toBe(0);
    });

    it("em trial, consome o peso do template até estourar o limite configurado", async () => {
      await prisma.subscription.update({
        where: { businessId: shop.id },
        data: { status: "trialing", whatsappTrialUsagePoints: env.WHATSAPP_TRIAL_USAGE_LIMIT - 2 },
      });
      // appointment_reminder pesa 2 (ver WHATSAPP_TEMPLATE_WEIGHTS) — cabe exatamente.
      const first = await tryConsumeWhatsappTrialBudget(shop.id, true, "appointment_reminder");
      expect(first).toBe(true);
      const sub = await getSubscription(shop.id);
      expect(sub?.whatsappTrialUsagePoints).toBe(env.WHATSAPP_TRIAL_USAGE_LIMIT);

      // Mais um ponto qualquer estoura o teto — deve recusar sem incrementar.
      const second = await tryConsumeWhatsappTrialBudget(shop.id, true, "appointment_reminder");
      expect(second).toBe(false);
      const subAfter = await getSubscription(shop.id);
      expect(subAfter?.whatsappTrialUsagePoints).toBe(env.WHATSAPP_TRIAL_USAGE_LIMIT);
    });

    it("um template não mapeado usa o peso padrão (1)", async () => {
      await prisma.subscription.update({ where: { businessId: shop.id }, data: { status: "trialing", whatsappTrialUsagePoints: 0 } });
      const ok = await tryConsumeWhatsappTrialBudget(shop.id, true, "template_desconhecido");
      expect(ok).toBe(true);
      const sub = await getSubscription(shop.id);
      expect(sub?.whatsappTrialUsagePoints).toBe(1);
    });
  });

  it("expireOverdueTrials vira canceled só quem está trialing E já passou do prazo", async () => {
    const pastShop = await prisma.business.create({ data: { name: "[teste] Trial Vencido" } });
    const futureShop = await prisma.business.create({ data: { name: "[teste] Trial Futuro" } });
    await prisma.subscription.create({
      data: { businessId: pastShop.id, status: "trialing", plan: "starter", trialEndsAt: new Date(Date.now() - 1000) },
    });
    await prisma.subscription.create({
      data: { businessId: futureShop.id, status: "trialing", plan: "starter", trialEndsAt: new Date(Date.now() + 60_000) },
    });

    await expireOverdueTrials();

    const past = await getSubscription(pastShop.id);
    const future = await getSubscription(futureShop.id);
    expect(past?.status).toBe("canceled");
    expect(future?.status).toBe("trialing");

    await prisma.subscription.deleteMany({ where: { businessId: { in: [pastShop.id, futureShop.id] } } });
    await prisma.business.deleteMany({ where: { id: { in: [pastShop.id, futureShop.id] } } });
  });

  describe("assertBarberLimitNotExceeded", () => {
    it("não trava quando não há assinatura ativa (sem sub ou em trial)", async () => {
      await prisma.subscription.update({ where: { businessId: shop.id }, data: { status: "trialing" } });
      await expect(assertBarberLimitNotExceeded(shop.id)).resolves.toBeUndefined();
    });

    it("trava no limite do plano Starter (2 barbeiros) só quando a assinatura está active", async () => {
      await prisma.professional.createMany({
        data: [
          { businessId: shop.id, name: "[teste] Barbeiro 1" },
          { businessId: shop.id, name: "[teste] Barbeiro 2" },
        ],
      });
      await prisma.subscription.update({ where: { businessId: shop.id }, data: { status: "active", plan: "starter" } });
      await expect(assertBarberLimitNotExceeded(shop.id)).rejects.toThrow(/plano starter permite até 2/);

      // Plano Pro (ilimitado) com a mesma contagem de barbeiros não trava.
      await prisma.subscription.update({ where: { businessId: shop.id }, data: { plan: "pro" } });
      await expect(assertBarberLimitNotExceeded(shop.id)).resolves.toBeUndefined();

      await prisma.professional.deleteMany({ where: { businessId: shop.id } });
    });
  });

  describe("assertProPlan", () => {
    it("rejeita quando o plano não é pro ou a assinatura não está active", async () => {
      await prisma.subscription.update({ where: { businessId: shop.id }, data: { status: "trialing", plan: "pro" } });
      await expect(assertProPlan(shop.id)).rejects.toThrow(/Pro/);

      await prisma.subscription.update({ where: { businessId: shop.id }, data: { status: "active", plan: "starter" } });
      await expect(assertProPlan(shop.id)).rejects.toThrow(/Pro/);
    });

    it("libera quando a assinatura está active no plano pro", async () => {
      await prisma.subscription.update({ where: { businessId: shop.id }, data: { status: "active", plan: "pro" } });
      await expect(assertProPlan(shop.id)).resolves.toBeUndefined();
    });
  });

  // getBillingOverview varre TODAS as barbearias do banco (dado real de
  // demonstração incluso), então só afirmamos sobre a linha da própria
  // barbearia de teste — não sobre os totais do summary, que dependem de
  // dados fora do controle deste teste.
  describe("getBillingOverview", () => {
    it("marca needsAttention quando a assinatura está past_due", async () => {
      await prisma.subscription.update({ where: { businessId: shop.id }, data: { status: "past_due", plan: "pro" } });
      const overview = await getBillingOverview();
      const row = overview.shops.find((s) => s.id === shop.id);
      expect(row).toBeTruthy();
      expect(row!.subscription?.status).toBe("past_due");
      expect(row!.needsAttention).toBe(true);
    });

    it("não marca needsAttention pra assinatura active em dia", async () => {
      await prisma.subscription.update({ where: { businessId: shop.id }, data: { status: "active", plan: "pro" } });
      const overview = await getBillingOverview();
      const row = overview.shops.find((s) => s.id === shop.id);
      expect(row!.needsAttention).toBe(false);
    });

    it("marca needsAttention quando o trial expira dentro de 3 dias", async () => {
      const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      await prisma.subscription.update({ where: { businessId: shop.id }, data: { status: "trialing", trialEndsAt: soon } });
      const overview = await getBillingOverview();
      const row = overview.shops.find((s) => s.id === shop.id);
      expect(row!.needsAttention).toBe(true);
    });

    it("não marca needsAttention pra trial que ainda tem mais de 3 dias", async () => {
      const later = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      await prisma.subscription.update({ where: { businessId: shop.id }, data: { status: "trialing", trialEndsAt: later } });
      const overview = await getBillingOverview();
      const row = overview.shops.find((s) => s.id === shop.id);
      expect(row!.needsAttention).toBe(false);
    });
  });
});
