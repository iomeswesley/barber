import { Router } from "express";
import { requireAuth, requireOwner } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { env } from "@/config/env.js";
import { stripe, stripeConfigured, PLAN_LABELS, PLAN_LIMITS, type PlanId } from "@/lib/stripe.js";
import { captureError } from "@/lib/errorReporting.js";
import {
  getSubscription,
  createCheckoutSession,
  changePlan,
  createPortalSession,
  handleCheckoutCompleted,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
} from "./billing.service.js";
import { getBarbershop } from "@/modules/businesses/businesses.repository.js";
import type Stripe from "stripe";

export const billingRouter = Router();

const VALID_PLANS: PlanId[] = ["starter", "pro"];

billingRouter.get("/api/billing/status", requireAuth, requireOwner, async (req, res) => {
  const [sub, shop] = await Promise.all([
    getSubscription(req.session.user!.businessId),
    getBarbershop(req.session.user!.businessId),
  ]);
  res.json({
    configured: stripeConfigured,
    status: sub?.status || null,
    plan: sub?.plan || null,
    trial_ends_at: sub?.trialEndsAt || null,
    current_period_end: sub?.currentPeriodEnd || null,
    has_subscription: !!sub?.stripeSubscriptionId,
    plans: VALID_PLANS.map((p) => ({ id: p, label: PLAN_LABELS[p], barber_limit: PLAN_LIMITS[p] })),
    // Só faz sentido mostrar durante o trial usando o número compartilhado —
    // ver tryConsumeWhatsappTrialBudget (billing.service.ts). Fora disso o
    // valor existe no banco mas não limita nada.
    whatsapp_trial_usage: sub?.status === "trialing" ? sub.whatsappTrialUsagePoints : null,
    whatsapp_trial_usage_limit: env.WHATSAPP_TRIAL_USAGE_LIMIT,
    // Qualquer status diferente de "not_connected" significa que a
    // barbearia já tem um número próprio conectado — "pending_templates"
    // (aguardando aprovação) e "error" (algum template rejeitado, mas a
    // conexão em si funciona) não são "sem WhatsApp próprio" (mesma
    // correção de 2026-09-04 que tirou "error" do showConnectFlow no
    // admin.html — os dois liam esse status como "desconectado" por engano).
    has_own_whatsapp: !!shop && shop.whatsappConnectionStatus !== "not_connected",
  });
});

billingRouter.post("/api/billing/checkout", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const plan = String(req.body?.plan || "");
    if (!VALID_PLANS.includes(plan as PlanId)) throw new AppError("Plano inválido");
    const base = env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const url = await createCheckoutSession(
      req.session.user!.businessId,
      plan as PlanId,
      `${base}/admin.html?billing=success`,
      `${base}/admin.html?billing=cancel`
    );
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

billingRouter.post("/api/billing/change-plan", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const plan = String(req.body?.plan || "");
    if (!VALID_PLANS.includes(plan as PlanId)) throw new AppError("Plano inválido");
    await changePlan(req.session.user!.businessId, plan as PlanId);
    res.json({ ok: true, plan });
  } catch (err) {
    next(err);
  }
});

billingRouter.post("/api/billing/portal", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const base = env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const url = await createPortalSession(req.session.user!.businessId, `${base}/admin.html`);
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

// Público — assinatura HMAC verificada abaixo é o que garante que a
// requisição veio mesmo do Stripe, não sessão/auth (mesmo modelo do
// webhook do WhatsApp).
billingRouter.post("/api/webhooks/stripe", async (req, res) => {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) return res.sendStatus(503);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody!, req.headers["stripe-signature"] as string, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[STRIPE] Assinatura de webhook inválida:", err);
    // Reportado pro Sentry: uma falha de assinatura persistente (secret
    // desatualizado no Vercel, endpoint duplicado no Stripe) passava batido
    // — só um console.error que ninguém olha, enquanto pagamentos reais
    // nunca sincronizavam com o Subscription local (ver incidente Professional
    // King, 2026-07-26).
    captureError(err);
    return res.sendStatus(400);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.updated":
      case "customer.subscription.created":
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      default:
        break; // outros eventos (invoice.*, payment_intent.*) não afetam o Subscription local
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("[STRIPE] Erro processando webhook:", err);
    captureError(err);
    // 200 mesmo em erro do nosso lado, pra evitar o Stripe reenviar
    // indefinidamente por um bug pontual — mesma decisão já tomada pro
    // webhook do WhatsApp. O Sentry acima é o que garante que o erro não
    // desaparece silenciosamente.
    res.sendStatus(200);
  }
});
