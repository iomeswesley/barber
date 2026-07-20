import { prisma } from "@/lib/prisma.js";
import type { ClientPlanBenefitType } from "@prisma/client";

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
