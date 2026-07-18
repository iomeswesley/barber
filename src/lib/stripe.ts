import Stripe from "stripe";
import { env } from "@/config/env.js";

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

export const PLAN_LABELS: Record<PlanId, string> = {
  starter: "Starter — R$ 99/mês (até 2 barbeiros)",
  pro: "Pro — R$ 149/mês (barbeiros ilimitados)",
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
