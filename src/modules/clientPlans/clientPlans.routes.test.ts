import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma.js";
import { env } from "@/config/env.js";
import { createApp } from "@/app.js";

// Cobre o webhook de Stripe Connect (src/modules/clientPlans/clientPlans.routes.ts):
// assinatura HMAC, e o roteamento dos 4 eventos que o painel de planos de
// assinatura pra clientes depende (conta conectada onboarded, checkout
// concluído, renovação/atualização e cancelamento de assinatura). Assina os
// payloads localmente com o mesmo STRIPE_CONNECT_WEBHOOK_SECRET de
// produção via Stripe.webhooks.generateTestHeaderString — cálculo puro de
// HMAC, sem nenhuma chamada de rede à Stripe. Eventos "thin" v2 (ver
// comentário no routes.ts sobre v2.core.account[...].updated) não são
// cobertos aqui: exigiriam mockar getAccountStatus (chamada real à API da
// Stripe) só pra exercitar um formato de payload que ainda não foi visto
// em produção fora da Corte Certo.
function signBody(rawBody: string): string {
  return Stripe.webhooks.generateTestHeaderString({ payload: rawBody, secret: env.STRIPE_CONNECT_WEBHOOK_SECRET! });
}

function eventPayload(id: string, type: string, dataObject: Record<string, unknown>): string {
  return JSON.stringify({ id, object: "event", type, data: { object: dataObject } });
}

describe("POST /api/webhooks/stripe-connect", () => {
  const app = createApp();
  const accountId = `acct_teste_${Date.now()}`;
  let business: { id: number };
  let client: { id: number };
  let plan: { id: number };

  beforeAll(async () => {
    if (!env.STRIPE_CONNECT_WEBHOOK_SECRET) throw new Error("STRIPE_CONNECT_WEBHOOK_SECRET precisa estar configurado pra rodar este teste.");
    business = await prisma.business.create({
      data: { name: "[teste] Webhook Stripe Connect", stripeConnectAccountId: accountId, stripeConnectOnboarded: false },
    });
    client = await prisma.client.create({ data: { name: "[teste] Cliente Webhook", phone: `teste-webhook-${Date.now()}` } });
    plan = await prisma.clientPlan.create({
      data: { businessId: business.id, name: "[teste] Plano Webhook", priceCents: 9900, benefitType: "services_included", benefitValue: 1 },
    });
  });

  afterAll(async () => {
    await prisma.clientPlanSubscription.deleteMany({ where: { businessId: business.id } });
    await prisma.clientPlan.deleteMany({ where: { businessId: business.id } });
    await prisma.client.deleteMany({ where: { id: client.id } });
    await prisma.business.deleteMany({ where: { id: business.id } });
  });

  it("rejeita com 400 sem assinatura válida", async () => {
    const raw = eventPayload("evt-teste-1", "account.updated", { id: accountId, charges_enabled: true, payouts_enabled: true });
    const res = await request(app)
      .post("/api/webhooks/stripe-connect")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", "t=1,v1=assinatura-forjada")
      .send(raw);
    expect(res.status).toBe(400);
  });

  it("account.updated: marca onboarded true só quando charges e payouts estão habilitados", async () => {
    const rawOff = eventPayload("evt-teste-2", "account.updated", { id: accountId, charges_enabled: true, payouts_enabled: false });
    const resOff = await request(app)
      .post("/api/webhooks/stripe-connect")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", signBody(rawOff))
      .send(rawOff);
    expect(resOff.status).toBe(200);
    let row = await prisma.business.findUnique({ where: { id: business.id } });
    expect(row?.stripeConnectOnboarded).toBe(false);

    const rawOn = eventPayload("evt-teste-3", "account.updated", { id: accountId, charges_enabled: true, payouts_enabled: true });
    const resOn = await request(app)
      .post("/api/webhooks/stripe-connect")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", signBody(rawOn))
      .send(rawOn);
    expect(resOn.status).toBe(200);
    row = await prisma.business.findUnique({ where: { id: business.id } });
    expect(row?.stripeConnectOnboarded).toBe(true);
  });

  it("checkout.session.completed: cria a assinatura do cliente vinculada ao plano", async () => {
    const raw = eventPayload("evt-teste-4", "checkout.session.completed", {
      id: "cs_teste_1",
      customer: "cus_teste_1",
      subscription: "sub_teste_1",
      metadata: { businessId: String(business.id), clientId: String(client.id), clientPlanId: String(plan.id) },
    });
    const res = await request(app)
      .post("/api/webhooks/stripe-connect")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", signBody(raw))
      .send(raw);
    expect(res.status).toBe(200);

    const sub = await prisma.clientPlanSubscription.findUnique({
      where: { clientId_clientPlanId: { clientId: client.id, clientPlanId: plan.id } },
    });
    expect(sub).toBeTruthy();
    expect(sub?.status).toBe("active");
    expect(sub?.stripeSubscriptionId).toBe("sub_teste_1");
    expect(sub?.stripeCustomerId).toBe("cus_teste_1");
  });

  it("customer.subscription.updated: atualiza status/período e zera a cota só quando o período avança", async () => {
    const firstPeriodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
    await prisma.clientPlanSubscription.update({
      where: { clientId_clientPlanId: { clientId: client.id, clientPlanId: plan.id } },
      data: { usedThisPeriod: 1, currentPeriodEnd: new Date(firstPeriodEnd * 1000) },
    });

    // Mesmo período (ex: troca de forma de pagamento) — não deve zerar a cota.
    const rawSamePeriod = eventPayload("evt-teste-5", "customer.subscription.updated", {
      id: "sub_teste_1",
      status: "active",
      current_period_end: firstPeriodEnd,
    });
    await request(app)
      .post("/api/webhooks/stripe-connect")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", signBody(rawSamePeriod))
      .send(rawSamePeriod);
    let sub = await prisma.clientPlanSubscription.findUnique({
      where: { clientId_clientPlanId: { clientId: client.id, clientPlanId: plan.id } },
    });
    expect(sub?.usedThisPeriod).toBe(1);

    // Período seguinte (renovação de verdade) — zera a cota consumida.
    const nextPeriodEnd = firstPeriodEnd + 30 * 86400;
    const rawNextPeriod = eventPayload("evt-teste-6", "customer.subscription.updated", {
      id: "sub_teste_1",
      status: "active",
      current_period_end: nextPeriodEnd,
    });
    const res = await request(app)
      .post("/api/webhooks/stripe-connect")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", signBody(rawNextPeriod))
      .send(rawNextPeriod);
    expect(res.status).toBe(200);
    sub = await prisma.clientPlanSubscription.findUnique({
      where: { clientId_clientPlanId: { clientId: client.id, clientPlanId: plan.id } },
    });
    expect(sub?.usedThisPeriod).toBe(0);
    expect(sub?.currentPeriodEnd?.getTime()).toBe(nextPeriodEnd * 1000);
  });

  it("customer.subscription.deleted: marca a assinatura como cancelada", async () => {
    const raw = eventPayload("evt-teste-7", "customer.subscription.deleted", { id: "sub_teste_1", status: "canceled" });
    const res = await request(app)
      .post("/api/webhooks/stripe-connect")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", signBody(raw))
      .send(raw);
    expect(res.status).toBe(200);

    const sub = await prisma.clientPlanSubscription.findUnique({
      where: { clientId_clientPlanId: { clientId: client.id, clientPlanId: plan.id } },
    });
    expect(sub?.status).toBe("canceled");
  });

  it("evento desconhecido: responde 200 sem quebrar (não afeta estado local)", async () => {
    const raw = eventPayload("evt-teste-8", "payment_intent.succeeded", { id: "pi_teste_1" });
    const res = await request(app)
      .post("/api/webhooks/stripe-connect")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", signBody(raw))
      .send(raw);
    expect(res.status).toBe(200);
  });
});
