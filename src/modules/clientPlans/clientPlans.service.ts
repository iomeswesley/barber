import { stripe, stripeConfigured } from "@/lib/stripe.js";
import { AppError } from "@/middleware/errorHandler.js";
import { env } from "@/config/env.js";
import { findOrCreateClient } from "@/modules/clients/clients.repository.js";
import { assertPhoneVerifiedRecently } from "@/modules/clients/phoneVerification.service.js";
import {
  getActiveSubscriptions,
  incrementUsedThisPeriod,
  getConnectAccountId,
  getClientPlan,
  getClientPlans,
  upsertSubscriptionFromCheckout,
  setSubscriptionStatusByStripeId,
  resetUsedThisPeriodByStripeId,
  getSubscriptionByStripeId,
} from "./clientPlans.repository.js";
import type { ClientPlanSubscriptionStatus } from "@prisma/client";
import type Stripe from "stripe";

export { stripeConfigured };

// Verificação de telefone: movida pra src/modules/clients/phoneVerification.ts
// em 2026-08-15 (reaproveitada agora pelas rotas de agendamento e exclusão
// LGPD) — reexportada aqui pra não quebrar quem já importa daqui
// (clientPlans.routes.ts, clientPlans.service.test.ts).
export {
  startPhoneVerification,
  confirmPhoneVerification,
  verifyPhoneViaTrustedChannel,
  assertPhoneVerifiedRecently,
} from "@/modules/clients/phoneVerification.service.js";

/* ---------------- Consumo do benefício no agendamento ---------------- */

export interface ChargeResolution {
  priceChargedCents: number | null; // null = preço de tabela normal
  subscriptionId: number | null;
  creditConsumed: boolean;
}

type ActiveSubscription = Awaited<ReturnType<typeof getActiveSubscriptions>>[number];

// Prioridade: benefício específico pro serviço agendado vale mais que um
// genérico (qualquer serviço) — evita que um "10% em qualquer serviço"
// prevaleça sobre um "corte grátis" que também se aplicaria.
function specificityScore(sub: ActiveSubscription): number {
  return sub.clientPlan.serviceId !== null ? 2 : 1;
}

export async function resolveChargedPrice(
  clientId: number,
  businessId: number,
  serviceId: number,
  listPriceCents: number
): Promise<ChargeResolution> {
  const subs = await getActiveSubscriptions(clientId, businessId);
  if (subs.length === 0) return { priceChargedCents: null, subscriptionId: null, creditConsumed: false };

  const bySpecificity = [...subs].sort((a, b) => specificityScore(b) - specificityScore(a));

  for (const sub of bySpecificity) {
    const plan = sub.clientPlan;
    if (plan.benefitType === "unlimited_service" && plan.serviceId === serviceId) {
      return { priceChargedCents: 0, subscriptionId: sub.id, creditConsumed: false };
    }
    if (plan.benefitType === "services_included" && (plan.serviceId === null || plan.serviceId === serviceId)) {
      if (sub.usedThisPeriod < plan.benefitValue) {
        await incrementUsedThisPeriod(sub.id);
        return { priceChargedCents: 0, subscriptionId: sub.id, creditConsumed: true };
      }
    }
  }

  const discountSub = bySpecificity.find((s) => s.clientPlan.benefitType === "percent_discount");
  if (discountSub) {
    const priceChargedCents = Math.round((listPriceCents * (100 - discountSub.clientPlan.benefitValue)) / 100);
    return { priceChargedCents, subscriptionId: discountSub.id, creditConsumed: false };
  }

  return { priceChargedCents: null, subscriptionId: null, creditConsumed: false };
}

// Lista de planos pra oferecer ao cliente — usado pelo bot de chat. Só
// mostra algo se a barbearia já concluiu o onboarding do Stripe Connect
// (senão o cliente veria um plano que não dá pra assinar de verdade).
export async function getOfferableClientPlans(businessId: number) {
  const connect = await getConnectAccountId(businessId);
  if (!connect?.stripeConnectOnboarded) return [];
  return getClientPlans(businessId, { includeInactive: false });
}

/* ---------------- Checkout público ---------------- */

export async function createClientPlanCheckoutSession(
  clientPlanId: number,
  phone: string,
  name: string,
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  if (!stripe) throw new AppError("Cobrança não configurada no servidor.", 503);

  const plan = await getClientPlan(clientPlanId);
  if (!plan || !plan.active) throw new AppError("Plano não encontrado", 404);
  if (!plan.stripePriceId) throw new AppError("Esse plano ainda não está pronto pra ser assinado.", 400);

  const connect = await getConnectAccountId(plan.businessId);
  if (!connect?.stripeConnectAccountId || !connect.stripeConnectOnboarded) {
    throw new AppError("Essa barbearia ainda não está pronta pra receber assinaturas.", 400);
  }

  await assertPhoneVerifiedRecently(phone);

  const client = await findOrCreateClient(name, phone);

  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { businessId: String(plan.businessId), clientId: String(client.id), clientPlanId: String(plan.id) },
      subscription_data: {
        metadata: { businessId: String(plan.businessId), clientId: String(client.id), clientPlanId: String(plan.id) },
        ...(env.PLATFORM_COMMISSION_PERCENT > 0 ? { application_fee_percent: env.PLATFORM_COMMISSION_PERCENT } : {}),
      },
    },
    { stripeAccount: connect.stripeConnectAccountId }
  );
  if (!session.url) throw new AppError("Erro ao criar sessão de checkout.", 502);
  return session.url;
}

/* ---------------- Webhook (Stripe Connect) ---------------- */

function mapStripeStatus(status: Stripe.Subscription.Status): ClientPlanSubscriptionStatus {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due" || status === "unpaid") return "past_due";
  return "canceled"; // canceled, incomplete, incomplete_expired, paused
}

export async function handleClientPlanCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const businessId = Number(session.metadata?.businessId);
  const clientId = Number(session.metadata?.clientId);
  const clientPlanId = Number(session.metadata?.clientPlanId);
  if (!businessId || !clientId || !clientPlanId || !session.subscription) return;
  const stripeSubscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  const stripeCustomerId = typeof session.customer === "string" ? session.customer : session.customer?.id || "";

  await upsertSubscriptionFromCheckout({
    businessId,
    clientId,
    clientPlanId,
    stripeSubscriptionId,
    stripeCustomerId,
    currentPeriodEnd: null, // preenchido pelo próximo customer.subscription.updated
  });
}

export async function handleClientPlanSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const stripeSubscriptionId = subscription.id;
  const currentPeriodEndSec = (subscription as unknown as { current_period_end?: number }).current_period_end;
  const newPeriodEnd = currentPeriodEndSec ? new Date(currentPeriodEndSec * 1000) : null;

  const existing = await getSubscriptionByStripeId(stripeSubscriptionId);
  await setSubscriptionStatusByStripeId(stripeSubscriptionId, mapStripeStatus(subscription.status), newPeriodEnd);

  // Só zera a cota consumida quando o período realmente avançou (renovação) —
  // não em qualquer update (ex: mudança de forma de pagamento).
  if (existing?.currentPeriodEnd && newPeriodEnd && newPeriodEnd.getTime() > existing.currentPeriodEnd.getTime()) {
    await resetUsedThisPeriodByStripeId(stripeSubscriptionId);
  }
}

export async function handleClientPlanSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  await setSubscriptionStatusByStripeId(subscription.id, "canceled");
}
