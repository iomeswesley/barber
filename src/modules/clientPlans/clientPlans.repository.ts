import { prisma } from "@/lib/prisma.js";
import type { ClientPlanBenefitType, ClientPlanSubscriptionStatus } from "@prisma/client";

export function getConnectAccountId(barbershopId: number) {
  return prisma.barbershop
    .findUnique({ where: { id: barbershopId }, select: { stripeConnectAccountId: true, stripeConnectOnboarded: true } });
}

export function saveConnectAccount(barbershopId: number, accountId: string) {
  return prisma.barbershop.update({ where: { id: barbershopId }, data: { stripeConnectAccountId: accountId } });
}

export function setConnectOnboardedByAccountId(accountId: string, onboarded: boolean) {
  return prisma.barbershop.updateMany({ where: { stripeConnectAccountId: accountId }, data: { stripeConnectOnboarded: onboarded } });
}

export function getClientPlans(barbershopId: number, { includeInactive = false } = {}) {
  return prisma.clientPlan.findMany({
    where: { barbershopId, ...(includeInactive ? {} : { active: true }) },
    orderBy: { id: "asc" },
  });
}

export function getClientPlan(id: number) {
  return prisma.clientPlan.findUnique({ where: { id } });
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

export function createClientPlan(barbershopId: number, input: CreateClientPlanInput) {
  return prisma.clientPlan.create({ data: { barbershopId, ...input } });
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

export function getActiveSubscriptions(clientId: number, barbershopId: number) {
  return prisma.clientPlanSubscription.findMany({
    where: { clientId, barbershopId, status: "active" },
    include: { clientPlan: true },
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
  barbershopId: number;
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

/* ---------------- Verificação de telefone ---------------- */

export function upsertPhoneVerification(phone: string, codeHash: string, expiresAt: Date) {
  return prisma.phoneVerification.upsert({
    where: { phone },
    update: { codeHash, expiresAt, attempts: 0, verifiedAt: null },
    create: { phone, codeHash, expiresAt, attempts: 0 },
  });
}

export function getPhoneVerification(phone: string) {
  return prisma.phoneVerification.findUnique({ where: { phone } });
}

export function incrementPhoneVerificationAttempts(phone: string) {
  return prisma.phoneVerification.update({ where: { phone }, data: { attempts: { increment: 1 } } });
}

export function markPhoneVerified(phone: string) {
  return prisma.phoneVerification.update({ where: { phone }, data: { verifiedAt: new Date() } });
}
