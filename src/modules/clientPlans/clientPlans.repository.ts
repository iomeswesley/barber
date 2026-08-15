import { prisma } from "@/lib/prisma.js";
import type { ClientPlanBenefitType, ClientPlanSubscriptionStatus } from "@prisma/client";

export function getConnectAccountId(businessId: number) {
  return prisma.business
    .findUnique({ where: { id: businessId }, select: { stripeConnectAccountId: true, stripeConnectOnboarded: true } });
}

export function saveConnectAccount(businessId: number, accountId: string) {
  return prisma.business.update({ where: { id: businessId }, data: { stripeConnectAccountId: accountId } });
}

export function setConnectOnboardedByAccountId(accountId: string, onboarded: boolean) {
  return prisma.business.updateMany({ where: { stripeConnectAccountId: accountId }, data: { stripeConnectOnboarded: onboarded } });
}

export function getClientPlans(businessId: number, { includeInactive = false } = {}) {
  return prisma.clientPlan.findMany({
    where: { businessId, ...(includeInactive ? {} : { active: true }) },
    orderBy: { id: "asc" },
  });
}

export function getClientPlan(id: number) {
  return prisma.clientPlan.findUnique({ where: { id } });
}

// Pro link público de assinatura (assinar-plano.html) — precisa do nome da
// barbearia e do serviço (quando o benefício é atrelado a um) pra montar a
// página sem exigir login nem escolher a barbearia num dropdown, já que o
// ID do plano sozinho já identifica os dois.
export function getClientPlanWithBusiness(id: number) {
  return prisma.clientPlan.findUnique({
    where: { id },
    include: {
      business: { select: { name: true, stripeConnectOnboarded: true } },
      service: { select: { name: true } },
    },
  });
}

export interface CreateClientPlanInput {
  name: string;
  priceCents: number;
  benefitType: ClientPlanBenefitType;
  benefitValue: number;
  serviceId?: number | null;
  stripeProductId: string;
  stripePriceId: string;
}

export function createClientPlan(businessId: number, input: CreateClientPlanInput) {
  return prisma.clientPlan.create({ data: { businessId, ...input } });
}

export interface UpdateClientPlanInput {
  name: string;
  priceCents: number;
  benefitType: ClientPlanBenefitType;
  benefitValue: number;
  serviceId?: number | null;
  stripeProductId: string;
  stripePriceId: string;
}

export function updateClientPlan(id: number, input: UpdateClientPlanInput) {
  return prisma.clientPlan.update({ where: { id }, data: input });
}

export function setClientPlanActive(id: number, active: boolean) {
  return prisma.clientPlan.update({ where: { id }, data: { active } });
}

/* ---------------- Assinaturas de cliente ---------------- */

export function getActiveSubscriptions(clientId: number, businessId: number) {
  return prisma.clientPlanSubscription.findMany({
    where: { clientId, businessId, status: "active" },
    include: { clientPlan: true },
  });
}

// Todas as assinaturas (qualquer status) de todos os clientes da barbearia —
// visão de conjunto pro dono, diferente de getActiveSubscriptions (só as
// ativas de UM cliente, usada no cálculo de benefício durante o agendamento).
export function getClientPlanSubscriptions(businessId: number) {
  return prisma.clientPlanSubscription.findMany({
    where: { businessId },
    include: { client: { select: { name: true, phone: true } }, clientPlan: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export function incrementUsedThisPeriod(id: number) {
  return prisma.clientPlanSubscription.update({ where: { id }, data: { usedThisPeriod: { increment: 1 } } });
}

// Nunca abaixo de 0 — usado quando um agendamento que consumiu uma cota é
// cancelado, pra devolver o crédito ao cliente.
export async function decrementUsedThisPeriod(id: number) {
  const sub = await prisma.clientPlanSubscription.findUnique({ where: { id } });
  if (!sub || sub.usedThisPeriod <= 0) return sub;
  return prisma.clientPlanSubscription.update({ where: { id }, data: { usedThisPeriod: { decrement: 1 } } });
}

export interface UpsertSubscriptionInput {
  businessId: number;
  clientId: number;
  clientPlanId: number;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  currentPeriodEnd: Date | null;
}

export function upsertSubscriptionFromCheckout(input: UpsertSubscriptionInput) {
  return prisma.clientPlanSubscription.upsert({
    where: { clientId_clientPlanId: { clientId: input.clientId, clientPlanId: input.clientPlanId } },
    update: {
      status: "active",
      stripeSubscriptionId: input.stripeSubscriptionId,
      stripeCustomerId: input.stripeCustomerId,
      currentPeriodEnd: input.currentPeriodEnd,
      usedThisPeriod: 0,
    },
    create: { ...input, status: "active", usedThisPeriod: 0 },
  });
}

export function setSubscriptionStatusByStripeId(
  stripeSubscriptionId: string,
  status: ClientPlanSubscriptionStatus,
  currentPeriodEnd?: Date | null
) {
  return prisma.clientPlanSubscription.updateMany({
    where: { stripeSubscriptionId },
    data: { status, ...(currentPeriodEnd !== undefined ? { currentPeriodEnd } : {}) },
  });
}

// Zera o consumo do período quando a Stripe avisa que a assinatura renovou
// (currentPeriodEnd avançou) — chamado só quando a data realmente mudou.
export function resetUsedThisPeriodByStripeId(stripeSubscriptionId: string) {
  return prisma.clientPlanSubscription.updateMany({ where: { stripeSubscriptionId }, data: { usedThisPeriod: 0 } });
}

export function getSubscriptionByStripeId(stripeSubscriptionId: string) {
  return prisma.clientPlanSubscription.findUnique({ where: { stripeSubscriptionId } });
}

// Verificação de telefone: movida pra src/modules/clients/phoneVerification.*
// em 2026-08-15 (o modelo PhoneVerification é genérico, sem FK pra
// ClientPlan, e passou a ser reaproveitado pelas rotas públicas de
// agendamento e exclusão LGPD, não só pelo checkout de plano).
