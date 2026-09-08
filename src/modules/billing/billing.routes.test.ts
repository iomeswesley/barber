import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma.js";
import { env } from "@/config/env.js";
import { createApp } from "@/app.js";

// Cobre o webhook da própria plataforma (src/modules/billing/billing.routes.ts,
// POST /api/webhooks/stripe — diferente do /stripe-connect, que é dos
// planos de assinatura da barbearia pros PRÓPRIOS clientes finais). Assina
// os payloads localmente com o STRIPE_WEBHOOK_SECRET de produção via
// Stripe.webhooks.generateTestHeaderString — cálculo puro de HMAC, sem
// nenhuma chamada de rede à Stripe.
//
// Achado em produção (2026-09-08): "Renova em —" sempre vazio no painel de
// Cobrança — handleSubscriptionUpdated lia `subscription.current_period_end`
// (nível da Subscription), mas a Stripe moveu esse campo pro nível do
// SubscriptionItem numa mudança de API ("flexible billing"). Sem teste
// nenhum cobrindo esse handler, o bug nunca apareceu numa suíte — só
// silenciosamente gravava currentPeriodEnd: undefined toda vez.
function signBody(rawBody: string): string {
  return Stripe.webhooks.generateTestHeaderString({ payload: rawBody, secret: env.STRIPE_WEBHOOK_SECRET! });
}

function eventPayload(id: string, type: string, dataObject: Record<string, unknown>): string {
  return JSON.stringify({ id, object: "event", type, data: { object: dataObject } });
}

describe("POST /api/webhooks/stripe", () => {
  const app = createApp();
  let business: { id: number };

  beforeAll(async () => {
    if (!env.STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET precisa estar configurado pra rodar este teste.");
    business = await prisma.business.create({ data: { name: "[teste] Webhook Stripe (billing)" } });
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { businessId: business.id } });
    await prisma.business.deleteMany({ where: { id: business.id } });
  });

  it("rejeita com 400 sem assinatura válida", async () => {
    const raw = eventPayload("evt-teste-billing-1", "customer.subscription.updated", { id: "sub_teste", status: "active" });
    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", "t=1,v1=assinatura-forjada")
      .send(raw);
    expect(res.status).toBe(400);
  });

  // Regressão do bug real: current_period_end vem dentro de
  // items.data[0], não no nível raiz da Subscription (mudança da API da
  // Stripe pra "flexible billing") — payload aqui é o shape real atual,
  // não o formato antigo que mascararia o bug.
  it("customer.subscription.updated: grava currentPeriodEnd lendo de items.data[0], não da raiz", async () => {
    const periodEndSec = Math.floor(Date.now() / 1000) + 30 * 86400;
    const raw = eventPayload("evt-teste-billing-2", "customer.subscription.updated", {
      id: "sub_teste_billing",
      status: "active",
      metadata: { businessId: String(business.id) },
      items: { data: [{ price: { id: env.STRIPE_PRICE_STARTER }, current_period_end: periodEndSec }] },
      // Campo de raiz propositalmente ausente/inválido — se o handler
      // ainda lesse daqui, currentPeriodEnd ficaria undefined e o teste
      // pegaria a regressão de volta.
    });
    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", signBody(raw))
      .send(raw);
    expect(res.status).toBe(200);

    const sub = await prisma.subscription.findUnique({ where: { businessId: business.id } });
    expect(sub?.status).toBe("active");
    expect(sub?.plan).toBe("starter");
    expect(sub?.currentPeriodEnd?.getTime()).toBe(periodEndSec * 1000);
  });

  it("customer.subscription.deleted: marca como canceled", async () => {
    const raw = eventPayload("evt-teste-billing-3", "customer.subscription.deleted", {
      id: "sub_teste_billing",
      status: "canceled",
      metadata: { businessId: String(business.id) },
    });
    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", signBody(raw))
      .send(raw);
    expect(res.status).toBe(200);

    const sub = await prisma.subscription.findUnique({ where: { businessId: business.id } });
    expect(sub?.status).toBe("canceled");
  });

  it("evento sem businessId no metadata: responde 200 mas não altera nada (não deixa travado)", async () => {
    const before = await prisma.subscription.findUnique({ where: { businessId: business.id } });
    const raw = eventPayload("evt-teste-billing-4", "customer.subscription.updated", {
      id: "sub_teste_billing",
      status: "active",
      metadata: {},
      items: { data: [{ price: { id: env.STRIPE_PRICE_PRO }, current_period_end: Math.floor(Date.now() / 1000) }] },
    });
    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", signBody(raw))
      .send(raw);
    expect(res.status).toBe(200);

    const after = await prisma.subscription.findUnique({ where: { businessId: business.id } });
    expect(after?.status).toBe(before?.status);
  });
});
