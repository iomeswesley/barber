import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/middleware/errorHandler.js";
import { env, vertical } from "@/config/env.js";
import { stripe, stripeConfigured, priceIdForPlan, planForPriceId, PLAN_LIMITS, PLAN_PRICE_CENTS, type PlanId } from "@/lib/stripe.js";
import { getOwnerUserForBarbershop } from "@/modules/auth/users.repository.js";
import { getBarbershop, getBarbershops } from "@/modules/businesses/businesses.repository.js";
import { getBarbers } from "@/modules/professionals/professionals.repository.js";
import { captureError } from "@/lib/errorReporting.js";
import type Stripe from "stripe";

export function getSubscription(businessId: number) {
  return prisma.subscription.findUnique({ where: { businessId } });
}

// Trava real de acesso (painel + bot de WhatsApp, ver requireBillingOk em
// src/middleware/billing.ts e o check equivalente em chatEngine.sendMessage)
// — só bloqueia "canceled" (trial vencido sem virar pagamento, ou assinatura
// paga cancelada/com falha definitiva no Stripe). NUNCA bloqueia por falta de
// linha de Subscription: barbearias de demonstração criadas fora do fluxo de
// onboarding (seed/prisma/seed.ts) nunca tiveram uma Subscription criada e
// não podem ser trancadas por isso. "past_due" (cartão recusado, Stripe ainda
// tentando cobrar de novo) também segue liberado — período de graça padrão
// de SaaS, só bloqueia quando o Stripe desiste de vez e o status vira
// "canceled" (ver handleSubscriptionUpdated/handleSubscriptionDeleted).
// Sem Stripe configurado no servidor, cobrança é só informativa — nunca bloqueia.
export async function isBillingBlocked(businessId: number): Promise<boolean> {
  if (!stripeConfigured) return false;
  const sub = await getSubscription(businessId);
  return sub?.status === "canceled";
}

// Visão de conjunto pro painel de superadmin — parte de TODAS as barbearias
// (não só quem já tem Subscription) porque uma barbearia que nunca passou
// por trial/checkout também é sinal útil ("sem assinatura registrada"), não
// deve simplesmente sumir da lista.
export async function getBillingOverview() {
  const [shops, subs] = await Promise.all([getBarbershops(), prisma.subscription.findMany()]);
  const subByShop = new Map(subs.map((s) => [s.businessId, s]));
  const now = new Date();
  const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const rows = shops.map((shop) => {
    const sub = subByShop.get(shop.id) ?? null;
    const trialSoon = !!(sub?.status === "trialing" && sub.trialEndsAt && sub.trialEndsAt >= now && sub.trialEndsAt <= soon);
    const needsAttention = sub?.status === "past_due" || sub?.status === "canceled" || trialSoon;
    return {
      id: shop.id,
      name: shop.name,
      whatsappConnectionStatus: shop.whatsappConnectionStatus,
      subscription: sub
        ? {
            status: sub.status,
            plan: sub.plan,
            trialEndsAt: sub.trialEndsAt,
            currentPeriodEnd: sub.currentPeriodEnd,
            stripeCustomerId: sub.stripeCustomerId,
          }
        : null,
      needsAttention,
    };
  });

  return {
    shops: rows,
    summary: {
      activeCount: rows.filter((r) => r.subscription?.status === "active").length,
      // MRR aqui é uma aproximação a partir do preço hardcoded em
      // PLAN_PRICE_CENTS, não o valor real cobrado no Stripe — se o preço
      // mudar direto no Stripe Dashboard sem atualizar esse arquivo (já
      // aconteceu: um checkout do Starter foi concluído a R$1 quando o preço
      // foi alterado temporariamente no Stripe), esse número fica
      // desatualizado silenciosamente. Tratar como estimativa, não como
      // fonte de verdade financeira — conferir no Stripe Dashboard antes de
      // qualquer decisão que dependa do valor exato.
      mrrCents: rows
        .filter((r) => r.subscription?.status === "active")
        .reduce((sum, r) => sum + (PLAN_PRICE_CENTS[r.subscription!.plan as PlanId] ?? 0), 0),
      trialsExpiringSoonCount: rows.filter((r) => r.subscription?.status === "trialing" && r.needsAttention).length,
      attentionCount: rows.filter((r) => r.needsAttention).length,
    },
  };
}

// Cortesia comercial concedida pelo painel de super-admin — pisa em cima do
// que tinha antes (status/plano/prazo), sem tocar no Stripe (não cria
// customer/checkout nenhum). Se a barbearia converter num plano de verdade
// depois, o webhook do Stripe sobrescreve isso normalmente.
export function grantTrial(businessId: number, plan: PlanId, trialEndsAt: Date) {
  return prisma.subscription.upsert({
    where: { businessId },
    update: { status: "trialing", plan, trialEndsAt },
    create: { businessId, status: "trialing", plan, trialEndsAt },
  });
}

// Peso relativo de cada template no orçamento de uso do trial — não é preço
// exato da Meta (isso só vem via webhook de status, não capturado hoje),
// é uma estimativa proporcional: reconquista (categoria "marketing") é
// disparado em massa pra clientes antigos sem pedido direto de ninguém, e é
// a categoria mais cara da Meta — pesa bem mais que lembrete/reagendamento
// (categoria "utility"), que são avisos pontuais de um agendamento real.
export const WHATSAPP_TEMPLATE_WEIGHTS: Record<string, number> = {
  appointment_reminder: 2,
  appointment_reschedule_notice: 2,
  come_back_message: 6,
};
const DEFAULT_TEMPLATE_WEIGHT = 1;

// Só entra em vigor pra quem ainda usa o número compartilhado da plataforma
// (usingSharedToken) E está em trial — barbearia paga, ou que já conectou o
// próprio WhatsApp via Embedded Signup, nunca é limitada aqui. Cobre só os
// envios automáticos e proativos (lembrete/reagendamento/reconquista) — não
// as respostas do chat ao cliente nem o código de verificação de plano, que
// são o próprio produto funcionando e não fazem sentido travar no meio do trial.
export async function tryConsumeWhatsappTrialBudget(
  businessId: number,
  usingSharedToken: boolean,
  templateName: string
): Promise<boolean> {
  if (!usingSharedToken) return true;
  const sub = await getSubscription(businessId);
  if (!sub || sub.status !== "trialing") return true;

  const weight = WHATSAPP_TEMPLATE_WEIGHTS[templateName] ?? DEFAULT_TEMPLATE_WEIGHT;
  if (sub.whatsappTrialUsagePoints + weight > env.WHATSAPP_TRIAL_USAGE_LIMIT) return false;

  await prisma.subscription.update({
    where: { businessId },
    data: { whatsappTrialUsagePoints: { increment: weight } },
  });
  return true;
}

async function getOrCreateStripeCustomer(businessId: number): Promise<string> {
  if (!stripe) throw new AppError("Cobrança não configurada no servidor.", 503);
  const sub = await getSubscription(businessId);
  if (sub?.stripeCustomerId) return sub.stripeCustomerId;

  const [shop, owner] = await Promise.all([getBarbershop(businessId), getOwnerUserForBarbershop(businessId)]);
  const customer = await stripe.customers.create({
    name: shop?.name || `Barbearia #${businessId}`,
    email: owner?.email || undefined,
    metadata: { businessId: String(businessId) },
  });
  await prisma.subscription.upsert({
    where: { businessId },
    update: { stripeCustomerId: customer.id },
    create: { businessId, stripeCustomerId: customer.id },
  });
  return customer.id;
}

export async function createCheckoutSession(
  businessId: number,
  plan: PlanId,
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  if (!stripe) throw new AppError("Cobrança não configurada no servidor.", 503);
  const priceId = priceIdForPlan(plan);
  if (!priceId) throw new AppError(`Plano "${plan}" não está configurado no servidor.`, 503);

  const customerId = await getOrCreateStripeCustomer(businessId);
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { businessId: String(businessId), plan },
    subscription_data: { metadata: { businessId: String(businessId), plan } },
  });
  if (!session.url) throw new AppError("Erro ao criar sessão de checkout.", 502);
  return session.url;
}

// Migra o plano de uma assinatura JÁ ativa (troca o price do item existente
// no Stripe) — diferente de createCheckoutSession, que sempre cria uma
// sessão nova e criaria uma SEGUNDA assinatura se usado aqui. O webhook
// customer.subscription.updated confirma a troca depois, mas atualizamos o
// plano local na hora também pra a UI não esperar o round-trip do webhook.
export async function changePlan(businessId: number, newPlan: PlanId): Promise<void> {
  if (!stripe) throw new AppError("Cobrança não configurada no servidor.", 503);
  const sub = await getSubscription(businessId);
  if (!sub?.stripeSubscriptionId) throw new AppError("Essa barbearia não tem uma assinatura ativa pra migrar.", 400);
  if (sub.plan === newPlan) throw new AppError(`Essa barbearia já está no plano ${newPlan}.`, 400);

  const newPriceId = priceIdForPlan(newPlan);
  if (!newPriceId) throw new AppError(`Plano "${newPlan}" não está configurado no servidor.`, 503);

  // Downgrade pra Starter tem limite de barbeiros ativos — bloqueia antes de
  // mexer no Stripe, pra não deixar a assinatura num estado que o painel
  // não consegue mais operar direito.
  if (newPlan === "starter") {
    const limit = PLAN_LIMITS.starter!;
    const activeCount = (await getBarbers(businessId)).length;
    if (activeCount > limit) {
      throw new AppError(
        `Você tem ${activeCount} ${vertical.professionalPlural} ativos — o plano Starter permite até ${limit}. Desative alguns ${vertical.professionalPlural} antes de migrar.`,
        400
      );
    }
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    const itemId = subscription.items.data[0]?.id;
    if (!itemId) throw new AppError("Não foi possível localizar o item da assinatura no Stripe.", 502);

    // always_invoice: cobra a diferença proporcional do restante do ciclo na
    // hora (não só no próximo boleto/fatura) — é o comportamento esperado de
    // upgrade num SaaS. error_if_incomplete: se essa cobrança falhar (cartão
    // recusado, exige autenticação), a troca de plano inteira é revertida —
    // não deixa a barbearia com o plano trocado e uma fatura pendurada.
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      items: [{ id: itemId, price: newPriceId }],
      proration_behavior: "always_invoice",
      payment_behavior: "error_if_incomplete",
      metadata: { businessId: String(businessId), plan: newPlan },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    // A chave de API (restrita) pode não ter as permissões de Subscriptions
    // habilitadas — mesma categoria de erro já vista ao investigar o
    // incidente do webhook em 2026-07-26. Sem esse tratamento, o erro cru do
    // Stripe cai no handler genérico e vira "Erro interno do servidor" sem
    // nenhuma pista de causa.
    // A mensagem do Stripe já vem específica sobre qual permissão falta (ex:
    // "Enabling 'Subscriptions Read' permissions..." vs "...Write...") — bem
    // mais útil que qualquer texto fixo nosso adivinhando qual é.
    const stripeErr = err as { type?: string; code?: string; message?: string };
    throw new AppError(`Erro do Stripe ao migrar de plano: ${stripeErr.message || "erro desconhecido"}`, 502);
  }

  await prisma.subscription.update({ where: { businessId }, data: { plan: newPlan } });
}

export async function createPortalSession(businessId: number, returnUrl: string): Promise<string> {
  if (!stripe) throw new AppError("Cobrança não configurada no servidor.", 503);
  const sub = await getSubscription(businessId);
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
export async function assertBarberLimitNotExceeded(businessId: number): Promise<void> {
  const sub = await getSubscription(businessId);
  if (!sub || sub.status !== "active") return;
  const limit = PLAN_LIMITS[sub.plan as PlanId];
  if (limit === null || limit === undefined) return;
  const activeCount = (await getBarbers(businessId)).length;
  if (activeCount >= limit) {
    throw new AppError(
      `Seu plano ${sub.plan} permite até ${limit} ${vertical.professional}(s) ativo(s). Faça upgrade pra Pro pra adicionar mais.`,
      403
    );
  }
}

// Gate de feature restrita ao plano Pro (ex: planos de assinatura pros
// clientes finais via Stripe Connect) — mesmo padrão imperativo de
// assertBarberLimitNotExceeded, chamado no topo dos route handlers.
export async function assertProPlan(businessId: number): Promise<void> {
  const sub = await getSubscription(businessId);
  if (!sub || sub.status !== "active" || sub.plan !== "pro") {
    throw new AppError("Esse recurso está disponível apenas no plano Pro.", 403);
  }
}

export function mapStripeStatus(status: Stripe.Subscription.Status): "trialing" | "active" | "past_due" | "canceled" {
  if (status === "trialing") return "trialing";
  if (status === "active") return "active";
  if (status === "past_due" || status === "unpaid") return "past_due";
  return "canceled"; // canceled, incomplete, incomplete_expired, paused
}

// Handlers de webhook — cada um recebe o evento já verificado (assinatura
// HMAC conferida na rota) e sincroniza o Subscription local com o estado
// real no Stripe.
export async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const businessId = Number(session.metadata?.businessId);
  if (!businessId || !session.subscription) {
    // Não devia acontecer no fluxo normal (createCheckoutSession sempre seta
    // esse metadata) — mas se acontecer, um pagamento real fica sem sincronizar
    // e sem deixar rastro nenhum além disso. Reporta pro Sentry em vez de
    // simplesmente sumir.
    captureError(
      new Error(
        `checkout.session.completed sem businessId/subscription válido (session=${session.id}, metadata=${JSON.stringify(session.metadata)})`
      )
    );
    return;
  }
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  const plan = session.metadata?.plan || "starter";
  // upsert, não update: getOrCreateStripeCustomer cria a linha antes do
  // checkout normalmente, mas se por qualquer motivo ela não existir (linha
  // apagada manualmente, corrida entre requisições), update() lançaria
  // "record not found" e um pagamento real ficaria sem sincronizar — mesma
  // categoria do incidente Professional King (2026-07-26): o pagamento existia no
  // Stripe, mas nada no nosso banco confirmava isso.
  await prisma.subscription.upsert({
    where: { businessId },
    update: { status: "active", plan, stripeSubscriptionId: subscriptionId },
    create: { businessId, status: "active", plan, stripeSubscriptionId: subscriptionId },
  });
}

export async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const businessId = Number(subscription.metadata?.businessId);
  if (!businessId) {
    captureError(new Error(`customer.subscription.updated sem businessId no metadata (subscription=${subscription.id})`));
    return;
  }
  const priceId = subscription.items.data[0]?.price?.id;
  const plan = planForPriceId(priceId);
  const currentPeriodEndSec = (subscription as unknown as { current_period_end?: number }).current_period_end;
  const status = mapStripeStatus(subscription.status);
  const currentPeriodEnd = currentPeriodEndSec ? new Date(currentPeriodEndSec * 1000) : undefined;
  // upsert pelo mesmo motivo de handleCheckoutCompleted: nunca deixar um
  // evento real do Stripe sem efeito nenhum no banco só porque a linha
  // ainda não existia. No update, plan só entra se resolvido (senão mantém
  // o que já tinha); no create, precisa de algum valor — "starter" como
  // fallback nunca deveria ser exercido na prática (subscription sempre
  // nasce com um price válido), mas evita um upsert inválido se acontecer.
  await prisma.subscription.upsert({
    where: { businessId },
    update: { status, ...(plan ? { plan } : {}), stripeSubscriptionId: subscription.id, currentPeriodEnd },
    create: { businessId, status, plan: plan || "starter", stripeSubscriptionId: subscription.id, currentPeriodEnd },
  });
}

export async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const businessId = Number(subscription.metadata?.businessId);
  if (!businessId) {
    captureError(new Error(`customer.subscription.deleted sem businessId no metadata (subscription=${subscription.id})`));
    return;
  }
  await prisma.subscription.upsert({
    where: { businessId },
    update: { status: "canceled" },
    create: { businessId, status: "canceled" },
  });
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
