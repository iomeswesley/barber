import { Router } from "express";
import { requireAuth, requireOwner, belongsToSession } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { env } from "@/config/env.js";
import { stripe } from "@/lib/stripe.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { toApiClientPlan } from "@/lib/apiMappers.js";
import { assertProPlan } from "@/modules/billing/billing.service.js";
import {
  createConnectAccount,
  createAccountLink,
  getAccountStatus,
  createConnectedProductAndPrice,
} from "@/lib/stripeConnect.js";
import {
  getConnectAccountId,
  saveConnectAccount,
  setConnectOnboardedByAccountId,
  getClientPlans,
  getClientPlan,
  createClientPlan,
  updateClientPlan,
  setClientPlanActive,
} from "./clientPlans.repository.js";
import type { ClientPlanBenefitType } from "@prisma/client";
import type Stripe from "stripe";

export const clientPlansRouter = Router();

const BENEFIT_TYPES: ClientPlanBenefitType[] = ["services_included", "percent_discount", "unlimited_service"];

function validatePlanBody(body: Record<string, unknown>) {
  const name = String(body.name || "").trim();
  const priceCents = Number(body.price_cents);
  const benefitType = String(body.benefit_type || "") as ClientPlanBenefitType;
  const benefitValue = Number(body.benefit_value);
  const serviceId = body.service_id != null ? Number(body.service_id) : null;

  if (!name) throw new AppError("Nome é obrigatório");
  if (!Number.isFinite(priceCents) || priceCents <= 0) throw new AppError("Preço inválido");
  if (!BENEFIT_TYPES.includes(benefitType)) throw new AppError("Tipo de benefício inválido");
  if (!Number.isFinite(benefitValue) || benefitValue <= 0) throw new AppError("Valor do benefício inválido");
  if (benefitType === "unlimited_service" && !serviceId) {
    throw new AppError("Benefício de acesso ilimitado exige um serviço específico");
  }
  return { name, priceCents, benefitType, benefitValue, serviceId };
}

/* ---------------- Onboarding Stripe Connect ---------------- */

clientPlansRouter.post("/api/manage/client-plans/connect/start", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const barbershopId = req.session.user!.barbershopId;
    await assertProPlan(barbershopId);

    let connect = await getConnectAccountId(barbershopId);
    let accountId = connect?.stripeConnectAccountId;
    if (!accountId) {
      accountId = await createConnectAccount(barbershopId);
      await saveConnectAccount(barbershopId, accountId);
    }

    const base = env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const returnUrl = `${base}/admin.html?connect=done`;
    const refreshUrl = `${base}/admin.html?connect=retry`;
    const url = await createAccountLink(accountId, returnUrl, refreshUrl);
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

clientPlansRouter.get("/api/manage/client-plans/connect/status", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const barbershopId = req.session.user!.barbershopId;
    const connect = await getConnectAccountId(barbershopId);
    if (!connect?.stripeConnectAccountId) {
      return res.json({ onboarded: false, charges_enabled: false, payouts_enabled: false });
    }
    const status = await getAccountStatus(connect.stripeConnectAccountId);
    res.json({ onboarded: connect.stripeConnectOnboarded, charges_enabled: status.chargesEnabled, payouts_enabled: status.payoutsEnabled });
  } catch (err) {
    next(err);
  }
});

/* ---------------- CRUD de planos ---------------- */

clientPlansRouter.get("/api/manage/client-plans", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const barbershopId = req.session.user!.barbershopId;
    await assertProPlan(barbershopId);
    const plans = await getClientPlans(barbershopId, { includeInactive: true });
    res.json(plans.map(toApiClientPlan));
  } catch (err) {
    next(err);
  }
});

clientPlansRouter.post("/api/manage/client-plans", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const barbershopId = req.session.user!.barbershopId;
    await assertProPlan(barbershopId);

    const connect = await getConnectAccountId(barbershopId);
    if (!connect?.stripeConnectAccountId || !connect.stripeConnectOnboarded) {
      throw new AppError("Ative o recebimento via Stripe Connect antes de criar um plano.", 400);
    }

    const { name, priceCents, benefitType, benefitValue, serviceId } = validatePlanBody(req.body || {});
    const { productId, priceId } = await createConnectedProductAndPrice(connect.stripeConnectAccountId, name, priceCents);
    const plan = await createClientPlan(barbershopId, {
      name,
      priceCents,
      benefitType,
      benefitValue,
      serviceId,
      stripeProductId: productId,
      stripePriceId: priceId,
    });
    await logAudit(barbershopId, req.session.user!.name, "Criou plano de assinatura pra clientes", plan.name);
    res.status(201).json(toApiClientPlan(plan));
  } catch (err) {
    next(err);
  }
});

clientPlansRouter.put("/api/manage/client-plans/:id", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const barbershopId = req.session.user!.barbershopId;
    await assertProPlan(barbershopId);

    const existing = await getClientPlan(Number(req.params.id));
    if (!belongsToSession(req, existing)) throw new AppError("Plano não encontrado", 404);

    const { name, priceCents, benefitType, benefitValue, serviceId } = validatePlanBody(req.body || {});

    let stripeProductId = existing!.stripeProductId!;
    let stripePriceId = existing!.stripePriceId!;
    if (priceCents !== existing!.priceCents || name !== existing!.name) {
      const connect = await getConnectAccountId(barbershopId);
      if (!connect?.stripeConnectAccountId) throw new AppError("Conta Stripe Connect não encontrada.", 400);
      const created = await createConnectedProductAndPrice(connect.stripeConnectAccountId, name, priceCents);
      stripeProductId = created.productId;
      stripePriceId = created.priceId;
    }

    const updated = await updateClientPlan(Number(req.params.id), {
      name,
      priceCents,
      benefitType,
      benefitValue,
      serviceId,
      stripeProductId,
      stripePriceId,
    });
    await logAudit(barbershopId, req.session.user!.name, "Editou plano de assinatura pra clientes", updated.name);
    res.json(toApiClientPlan(updated));
  } catch (err) {
    next(err);
  }
});

clientPlansRouter.post("/api/manage/client-plans/:id/active", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const barbershopId = req.session.user!.barbershopId;
    await assertProPlan(barbershopId);
    const existing = await getClientPlan(Number(req.params.id));
    if (!belongsToSession(req, existing)) throw new AppError("Plano não encontrado", 404);
    const updated = await setClientPlanActive(Number(req.params.id), !!req.body?.active);
    await logAudit(
      barbershopId,
      req.session.user!.name,
      req.body?.active ? "Ativou plano de assinatura pra clientes" : "Desativou plano de assinatura pra clientes",
      updated.name
    );
    res.json(toApiClientPlan(updated));
  } catch (err) {
    next(err);
  }
});

/* ---------------- Webhook Stripe Connect ---------------- */

// Público — endpoint separado do webhook de billing da plataforma (eventos
// de conta conectada chegam com event.account setado e usam um secret de
// assinatura próprio). Sem STRIPE_CONNECT_WEBHOOK_SECRET configurado, a
// rota fica fechada (fail-closed), mesmo padrão corrigido no webhook do
// WhatsApp — nunca aceitar requisição sem assinatura verificada.
clientPlansRouter.post("/api/webhooks/stripe-connect", async (req, res) => {
  if (!stripe || !env.STRIPE_CONNECT_WEBHOOK_SECRET) return res.sendStatus(503);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody!,
      req.headers["stripe-signature"] as string,
      env.STRIPE_CONNECT_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("[STRIPE CONNECT] Assinatura de webhook inválida:", err);
    return res.sendStatus(400);
  }

  try {
    if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;
      const onboarded = !!account.charges_enabled && !!account.payouts_enabled;
      await setConnectOnboardedByAccountId(account.id, onboarded);
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("[STRIPE CONNECT] Erro processando webhook:", err);
    res.sendStatus(200);
  }
});
