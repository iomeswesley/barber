import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/middleware/errorHandler.js";
import { stripe, stripeConfigured, priceIdForPlan, planForPriceId, PLAN_LIMITS, type PlanId } from "@/lib/stripe.js";
import { getOwnerUserForBarbershop } from "@/modules/auth/users.repository.js";
import { getBarbershop } from "@/modules/barbershops/barbershops.repository.js";
import { getBarbers } from "@/modules/barbers/barbers.repository.js";
import type Stripe from "stripe";

export function getSubscription(barbershopId: number) {
  return prisma.subscription.findUnique({ where: { barbershopId } });
}

async function getOrCreateStripeCustomer(barbershopId: number): Promise<string> {
  if (!stripe) throw new AppError("Cobrança não configurada no servidor.", 503);
  const sub = await getSubscription(barbershopId);
  if (sub?.stripeCustomerId) return sub.stripeCustomerId;

  const [shop, owner] = await Promise.all([getBarbershop(barbershopId), getOwnerUserForBarbershop(barbershopId)]);
  const customer = await stripe.customers.create({
    name: shop?.name || `Barbearia #${barbershopId}`,
    email: owner?.email || undefined,
    metadata: { barbershopId: String(barbershopId) },
  });
  await prisma.subscription.upsert({
    where: { barbershopId },
    update: { stripeCustomerId: customer.id },
    create: { barbershopId, stripeCustomerId: customer.id },
  });
  return customer.id;
}

export async function createCheckoutSession(
  barbershopId: number,
  plan: PlanId,
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  if (!stripe) throw new AppError("Cobrança não configurada no servidor.", 503);
  const priceId = priceIdForPlan(plan);
  if (!priceId) throw new AppError(`Plano "${plan}" não está configurado no servidor.`, 503);

  const customerId = await getOrCreateStripeCustomer(barbershopId);
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { barbershopId: String(barbershopId), plan },
    subscription_data: { metadata: { barbershopId: String(barbershopId), plan } },
  });
  if (!session.url) throw new AppError("Erro ao criar sessão de checkout.", 502);
  return session.url;
}

export async function createPortalSession(barbershopId: number, returnUrl: string): Promise<string> {
  if (!stripe) throw new AppError("Cobrança não configurada no servidor.", 503);
  const sub = await getSubscription(barbershopId);
  if (!sub?.stripeCustomerId) {
    throw new AppError("Essa barbearia ainda não tem uma assinatura — assine um plano primeiro.", 400);
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: returnUrl,
  });
  return session.url;
}

// Trava opcional na criação/reativação de barbeiro: só entra em vigor com
// assinatura "active" (paga de verdade) no plano Starter — durante o
// trial, deixa testar sem limite pra não capar a avaliação do produto.
export async function assertBarberLimitNotExceeded(barbershopId: number): Promise<void> {
  const sub = await getSubscription(barbershopId);
  if (!sub || sub.status !== "active") return;
  const limit = PLAN_LIMITS[sub.plan as PlanId];
  if (limit === null || limit === undefined) return;
  const activeCount = (await getBarbers(barbershopId)).length;
  if (activeCount >= limit) {
    throw new AppError(
      `Seu plano ${sub.plan} permite até ${limit} barbeiro(s) ativo(s). Faça upgrade pra Pro pra adicionar mais.`,
      403
    );
  }
}

function mapStripeStatus(status: Stripe.Subscription.Status): "trialing" | "active" | "past_due" | "canceled" {
  if (status === "trialing") return "trialing";
  if (status === "active") return "active";
  if (status === "past_due" || status === "unpaid") return "past_due";
  return "canceled"; // canceled, incomplete, incomplete_expired, paused
}

// Handlers de webhook — cada um recebe o evento já verificado (assinatura
// HMAC conferida na rota) e sincroniza o Subscription local com o estado
// real no Stripe.
export async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const barbershopId = Number(session.metadata?.barbershopId);
  if (!barbershopId || !session.subscription) return;
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  const plan = session.metadata?.plan || "starter";
  await prisma.subscription.update({
    where: { barbershopId },
    data: { status: "active", plan, stripeSubscriptionId: subscriptionId },
  });
}

export async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const barbershopId = Number(subscription.metadata?.barbershopId);
  if (!barbershopId) return;
  const priceId = subscription.items.data[0]?.price?.id;
  const plan = planForPriceId(priceId) || undefined;
  const currentPeriodEndSec = (subscription as unknown as { current_period_end?: number }).current_period_end;
  await prisma.subscription.update({
    where: { barbershopId },
    data: {
      status: mapStripeStatus(subscription.status),
      ...(plan ? { plan } : {}),
      stripeSubscriptionId: subscription.id,
      currentPeriodEnd: currentPeriodEndSec ? new Date(currentPeriodEndSec * 1000) : undefined,
    },
  });
}

export async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const barbershopId = Number(subscription.metadata?.barbershopId);
  if (!barbershopId) return;
  await prisma.subscription.update({ where: { barbershopId }, data: { status: "canceled" } });
}

// Chamado pelo cron diário (mesma rota de lembretes) — trials que passaram
// da data e nunca converteram em assinatura viram "canceled" (não tem
// status melhor pra "trial acabou, sem pagamento"), o que já basta pro
// banner do painel avisar o dono.
export async function expireOverdueTrials(): Promise<number> {
  const result = await prisma.subscription.updateMany({
    where: { status: "trialing", trialEndsAt: { lt: new Date() } },
    data: { status: "canceled" },
  });
  return result.count;
}

export { stripeConfigured };
