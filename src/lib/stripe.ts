import Stripe from "stripe";
import { env, vertical } from "@/config/env.js";
import { formatMoney } from "@/lib/locale.js";

// Opcional: sem STRIPE_SECRET_KEY, a aba de cobrança fica visível (mostra
// status do trial) mas os botões de assinar/gerenciar ficam desabilitados
// em vez de quebrar a página.
export const stripeConfigured = !!env.STRIPE_SECRET_KEY;

export const stripe = stripeConfigured ? new Stripe(env.STRIPE_SECRET_KEY!) : null;

export type PlanId = "starter" | "pro";

// Limite de barbeiros ativos por plano — null = sem limite. Usado só pra
// mostrar/checar no painel; o Stripe em si não sabe nada sobre "barbeiro".
export const PLAN_LIMITS: Record<PlanId, number | null> = {
  starter: 2,
  pro: null,
};

// Preço de tabela por moeda do deploy (cada região tem o seu deploy, então
// APP_DEFAULT_CURRENCY decide). BRL mantém o histórico; qualquer outra moeda
// (EUR, USD) usa a tabela internacional. O valor real cobrado é o do Price
// configurado no Stripe (STRIPE_PRICE_*) — estes números só alimentam rótulos,
// landing e estimativa de MRR, e têm que bater com o que existe lá.
const PRICES_BRL: Record<PlanId, number> = { starter: 9900, pro: 14900 };
const PRICES_INTERNATIONAL: Record<PlanId, number> = { starter: 7900, pro: 9900 };

// Usado só pra estimar MRR no painel de superadmin e mostrar preço na UI — não
// é o valor real cobrado no Stripe (que pode ter sido alterado direto no
// Dashboard sem atualizar aqui, como já aconteceu). Manter em sincronia manual
// com o Price do Stripe.
export const PLAN_PRICE_CENTS: Record<PlanId, number> = env.APP_DEFAULT_CURRENCY === "BRL" ? PRICES_BRL : PRICES_INTERNATIONAL;

export const PLAN_LABELS: Record<PlanId, string> = {
  starter: `Starter — ${formatMoney(PLAN_PRICE_CENTS.starter, env.APP_DEFAULT_CURRENCY, env.APP_DEFAULT_LOCALE)}/mês (até 2 ${vertical.professionalPlural})`,
  pro: `Pro — ${formatMoney(PLAN_PRICE_CENTS.pro, env.APP_DEFAULT_CURRENCY, env.APP_DEFAULT_LOCALE)}/mês (${vertical.professionalPlural} ilimitados)`,
};

export function priceIdForPlan(plan: string): string | undefined {
  if (plan === "starter") return env.STRIPE_PRICE_STARTER;
  if (plan === "pro") return env.STRIPE_PRICE_PRO;
  return undefined;
}

export function planForPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  if (priceId === env.STRIPE_PRICE_STARTER) return "starter";
  if (priceId === env.STRIPE_PRICE_PRO) return "pro";
  return null;
}
