import { Router } from "express";
import { requireAuth, requireOwner, belongsToSession } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { env, vertical } from "@/config/env.js";
import { stripe } from "@/lib/stripe.js";
import { normalizePhone } from "@/lib/time.js";
import { selfServiceRateLimiter, otpRateLimiter } from "@/middleware/rateLimiter.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { toApiClientPlan } from "@/lib/apiMappers.js";
import { assertProPlan } from "@/modules/billing/billing.service.js";
import { describeClientPlanBenefit } from "@/modules/chat/chatEngine.js";
import {
  createConnectAccount,
  createAccountLink,
  getAccountStatus,
  createConnectedProductAndPrice,
} from "@/lib/stripeConnect.js";
import {
  startPhoneVerification,
  confirmPhoneVerification,
  createClientPlanCheckoutSession,
  handleClientPlanCheckoutCompleted,
  handleClientPlanSubscriptionUpdated,
  handleClientPlanSubscriptionDeleted,
} from "./clientPlans.service.js";
import {
  getConnectAccountId,
  saveConnectAccount,
  setConnectOnboardedByAccountId,
  getClientPlans,
  getClientPlan,
  getClientPlanWithBusiness,
  createClientPlan,
  updateClientPlan,
  setClientPlanActive,
  getClientPlanSubscriptions,
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
    const businessId = req.session.user!.businessId;
    await assertProPlan(businessId);

    let connect = await getConnectAccountId(businessId);
    let accountId = connect?.stripeConnectAccountId;
    if (!accountId) {
      accountId = await createConnectAccount(businessId);
      await saveConnectAccount(businessId, accountId);
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
    const businessId = req.session.user!.businessId;
    const connect = await getConnectAccountId(businessId);
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
    const businessId = req.session.user!.businessId;
    await assertProPlan(businessId);
    const plans = await getClientPlans(businessId, { includeInactive: true });
    res.json(plans.map(toApiClientPlan));
  } catch (err) {
    next(err);
  }
});

// Visão de conjunto de todas as assinaturas (ativas, atrasadas, canceladas)
// de todos os clientes — diferente das rotas acima, que só gerenciam os
// TIPOS de plano oferecidos, não quem de fato assinou.
clientPlansRouter.get("/api/manage/client-plans/subscriptions", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const businessId = req.session.user!.businessId;
    await assertProPlan(businessId);
    const subs = await getClientPlanSubscriptions(businessId);
    res.json(
      subs.map((s) => ({
        id: s.id,
        cliente_nome: s.client.name,
        cliente_telefone: s.client.phone,
        plano_nome: s.clientPlan.name,
        status: s.status,
        valido_ate: s.currentPeriodEnd,
        assinado_em: s.createdAt,
      }))
    );
  } catch (err) {
    next(err);
  }
});

clientPlansRouter.post("/api/manage/client-plans", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const businessId = req.session.user!.businessId;
    await assertProPlan(businessId);

    const connect = await getConnectAccountId(businessId);
    if (!connect?.stripeConnectAccountId || !connect.stripeConnectOnboarded) {
      throw new AppError("Ative o recebimento via Stripe Connect antes de criar um plano.", 400);
    }

    const { name, priceCents, benefitType, benefitValue, serviceId } = validatePlanBody(req.body || {});
    const { productId, priceId } = await createConnectedProductAndPrice(connect.stripeConnectAccountId, name, priceCents);
    const plan = await createClientPlan(businessId, {
      name,
      priceCents,
      benefitType,
      benefitValue,
      serviceId,
      stripeProductId: productId,
      stripePriceId: priceId,
    });
    await logAudit(businessId, req.session.user!.name, `Criou plano de assinatura pra ${vertical.clientPlural}`, plan.name);
    res.status(201).json(toApiClientPlan(plan));
  } catch (err) {
    next(err);
  }
});

clientPlansRouter.put("/api/manage/client-plans/:id", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const businessId = req.session.user!.businessId;
    await assertProPlan(businessId);

    const existing = await getClientPlan(Number(req.params.id));
    if (!belongsToSession(req, existing)) throw new AppError("Plano não encontrado", 404);

    const { name, priceCents, benefitType, benefitValue, serviceId } = validatePlanBody(req.body || {});

    let stripeProductId = existing!.stripeProductId!;
    let stripePriceId = existing!.stripePriceId!;
    if (priceCents !== existing!.priceCents || name !== existing!.name) {
      const connect = await getConnectAccountId(businessId);
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
    await logAudit(businessId, req.session.user!.name, `Editou plano de assinatura pra ${vertical.clientPlural}`, updated.name);
    res.json(toApiClientPlan(updated));
  } catch (err) {
    next(err);
  }
});

clientPlansRouter.post("/api/manage/client-plans/:id/active", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const businessId = req.session.user!.businessId;
    await assertProPlan(businessId);
    const existing = await getClientPlan(Number(req.params.id));
    if (!belongsToSession(req, existing)) throw new AppError("Plano não encontrado", 404);
    const updated = await setClientPlanActive(Number(req.params.id), !!req.body?.active);
    await logAudit(
      businessId,
      req.session.user!.name,
      req.body?.active ? `Ativou plano de assinatura pra ${vertical.clientPlural}` : `Desativou plano de assinatura pra ${vertical.clientPlural}`,
      updated.name
    );
    res.json(toApiClientPlan(updated));
  } catch (err) {
    next(err);
  }
});

/* ---------------- Público — verificação + checkout do cliente final ---------------- */

clientPlansRouter.get("/api/public/barbershops/:id/client-plans", selfServiceRateLimiter, async (req, res, next) => {
  try {
    const businessId = Number(req.params.id);
    const connect = await getConnectAccountId(businessId);
    if (!connect?.stripeConnectOnboarded) return res.json([]);
    const plans = await getClientPlans(businessId, { includeInactive: false });
    res.json(plans.map(toApiClientPlan));
  } catch (err) {
    next(err);
  }
});

// Detalhe público de UM plano — base do link direto de assinatura
// (webroot/assinar-plano.html, ?plan=<id>) que o dono copia em Configurações
// ou que a IA manda no chat: com o ID do plano só, a página já sabe qual
// barbearia é, sem precisar de dropdown nem do cliente escolher nada.
clientPlansRouter.get("/api/public/client-plans/:id", selfServiceRateLimiter, async (req, res, next) => {
  try {
    const plan = await getClientPlanWithBusiness(Number(req.params.id));
    if (!plan || !plan.active || !plan.business.stripeConnectOnboarded) {
      throw new AppError("Plano não encontrado", 404);
    }
    res.json({
      ...toApiClientPlan(plan),
      business_name: plan.business.name,
      benefit_description: describeClientPlanBenefit(plan, plan.service?.name),
    });
  } catch (err) {
    next(err);
  }
});

clientPlansRouter.post("/api/public/client-plans/verify/start", otpRateLimiter, async (req, res, next) => {
  try {
    const businessId = Number(req.body?.businessId);
    const phone = normalizePhone(req.body?.phone);
    if (!businessId || !phone) throw new AppError("Telefone e barbearia são obrigatórios");
    await startPhoneVerification(businessId, phone);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

clientPlansRouter.post("/api/public/client-plans/verify/confirm", otpRateLimiter, async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const code = String(req.body?.code || "").trim();
    if (!phone || !code) throw new AppError("Telefone e código são obrigatórios");
    await confirmPhoneVerification(phone, code);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

clientPlansRouter.post("/api/public/client-plans/:id/checkout", selfServiceRateLimiter, async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const name = String(req.body?.name || "").trim();
    if (!phone || !name) throw new AppError("Nome e telefone são obrigatórios");

    const base = env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const planId = Number(req.params.id);
    const url = await createClientPlanCheckoutSession(
      planId,
      phone,
      name,
      `${base}/assinar-plano.html?plan=${planId}&status=success`,
      `${base}/assinar-plano.html?plan=${planId}&status=cancel`
    );
    res.json({ url });
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
    // Esse endpoint recebe uma MISTURA de eventos v1 ("checkout.session.completed",
    // "customer.subscription.*") e v2 ("v2.core.account[...].updated") — e o
    // próprio SDK do Stripe exige métodos diferentes pra cada um:
    // stripe.webhooks.constructEvent() REJEITA notificação v2 (lança erro
    // "Use stripe.parseEventNotification instead"), e o inverso também é
    // verdade. Sem essa distinção, todo evento v2 batia como "assinatura
    // inválida" (400) mesmo com o secret certo — descoberto ao testar o
    // payload real de conta conectada da Corte Certo.
    const rawBody = req.rawBody!;
    let isV2Notification = false;
    try {
      isV2Notification = JSON.parse(rawBody.toString("utf8"))?.object === "v2.core.event";
    } catch {
      // corpo não é JSON válido — deixa o parser abaixo rejeitar normalmente
    }
    const signature = req.headers["stripe-signature"] as string;
    event = (
      isV2Notification
        ? stripe.parseEventNotification(rawBody, signature, env.STRIPE_CONNECT_WEBHOOK_SECRET)
        : stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_CONNECT_WEBHOOK_SECRET)
    ) as unknown as Stripe.Event;
  } catch (err) {
    console.error("[STRIPE CONNECT] Assinatura de webhook inválida:", err);
    return res.sendStatus(400);
  }

  try {
    switch (event.type) {
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        const onboarded = !!account.charges_enabled && !!account.payouts_enabled;
        await setConnectOnboardedByAccountId(account.id, onboarded);
        break;
      }
      case "checkout.session.completed":
        await handleClientPlanCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.updated":
      case "customer.subscription.created":
        await handleClientPlanSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await handleClientPlanSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      default:
        // Contas criadas em versões recentes da API do Stripe (confirmado:
        // 2026-06-24.dahlia) não disparam mais "account.updated" (v1) quando
        // a identidade/requirements mudam — só eventos v2, tipo
        // "v2.core.account[identity].updated" ou "v2.core.account[requirements].updated".
        // Esses eventos são "thin": não trazem charges_enabled/payouts_enabled
        // no payload (só o que mudou em changes.before/after, formato
        // diferente por sub-recurso). Em vez de tentar interpretar cada
        // variante, qualquer evento desse tipo só serve de gatilho pra reler
        // o status real da conta via API v1 (stripe.accounts.retrieve, a
        // mesma getAccountStatus já usada pelo painel) — sempre confiável,
        // independente de qual sub-recurso mudou ou de qual formato a Stripe
        // decidir usar no futuro.
        if (event.type.startsWith("v2.core.account[")) {
          const accountId = (event as unknown as { related_object?: { id?: string; type?: string } }).related_object?.id;
          if (accountId) {
            const status = await getAccountStatus(accountId);
            await setConnectOnboardedByAccountId(accountId, status.chargesEnabled && status.payoutsEnabled);
          }
        }
        break; // outros eventos de conta conectada (invoice.*, payment_intent.*) não afetam o estado local
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("[STRIPE CONNECT] Erro processando webhook:", err);
    res.sendStatus(200);
  }
});
