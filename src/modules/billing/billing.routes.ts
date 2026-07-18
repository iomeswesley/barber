import { Router } from "express";
import { requireAuth, requireOwner } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { env } from "@/config/env.js";
import { stripe, stripeConfigured, PLAN_LABELS, PLAN_LIMITS, type PlanId } from "@/lib/stripe.js";
import {
  getSubscription,
  createCheckoutSession,
  createPortalSession,
  handleCheckoutCompleted,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
} from "./billing.service.js";
import type Stripe from "stripe";

export const billingRouter = Router();

const VALID_PLANS: PlanId[] = ["starter", "pro"];

billingRouter.get("/api/billing/status", requireAuth, requireOwner, async (req, res) => {
  const sub = await getSubscription(req.session.user!.barbershopId);
  res.json({
    configured: stripeConfigured,
    status: sub?.status || null,
    plan: sub?.plan || null,
    trial_ends_at: sub?.trialEndsAt || null,
    current_period_end: sub?.currentPeriodEnd || null,
    has_subscription: !!sub?.stripeSubscriptionId,
    plans: VALID_PLANS.map((p) => ({ id: p, label: PLAN_LABELS[p], barber_limit: PLAN_LIMITS[p] })),
  });
});

billingRouter.post("/api/billing/checkout", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const plan = String(req.body?.plan || "");
    if (!VALID_PLANS.includes(plan as PlanId)) throw new AppError("Plano inválido");
    const base = env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const url = await createCheckoutSession(
      req.session.user!.barbershopId,
      plan as PlanId,
      `${base}/admin.html?billing=success`,
      `${base}/admin.html?billing=cancel`
    );
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

billingRouter.post("/api/billing/portal", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const base = env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const url = await createPortalSession(req.session.user!.barbershopId, `${base}/admin.html`);
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
    // 200 mesmo em erro do nosso lado, pra evitar o Stripe reenviar
    // indefinidamente por um bug pontual — mesma decisão já tomada pro
    // webhook do WhatsApp.
    res.sendStatus(200);
  }
});
