import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma.js";
import { getClientPlans, getClientPlan } from "./clientPlans.repository.js";

// Teste de integração: usa o banco real. Cobre o isolamento entre tenants
// na listagem de planos de assinatura — plano de uma barbearia não pode
// vazar pra query de outra (mesma garantia já coberta pra appointments/clients).
describe("getClientPlans (isolamento entre tenants)", () => {
  let shopA: { id: number };
  let shopB: { id: number };
  let planA: { id: number };
  let planB: { id: number };

  beforeAll(async () => {
    shopA = await prisma.barbershop.create({ data: { name: "[teste] Shop A" } });
    shopB = await prisma.barbershop.create({ data: { name: "[teste] Shop B" } });
    planA = await prisma.clientPlan.create({
      data: {
        barbershopId: shopA.id,
        name: "[teste] Plano A",
        priceCents: 9900,
        benefitType: "services_included",
        benefitValue: 2,
      },
    });
    planB = await prisma.clientPlan.create({
      data: {
        barbershopId: shopB.id,
        name: "[teste] Plano B",
        priceCents: 14900,
        benefitType: "percent_discount",
        benefitValue: 10,
      },
    });
  });

  afterAll(async () => {
    await prisma.clientPlan.deleteMany({ where: { id: { in: [planA.id, planB.id] } } });
    await prisma.barbershop.deleteMany({ where: { id: { in: [shopA.id, shopB.id] } } });
  });

  it("lista só os planos da barbearia informada", async () => {
    const plansA = await getClientPlans(shopA.id, { includeInactive: true });
    expect(plansA.map((p) => p.id)).toEqual([planA.id]);

    const plansB = await getClientPlans(shopB.id, { includeInactive: true });
    expect(plansB.map((p) => p.id)).toEqual([planB.id]);
  });

  it("getClientPlan retorna barbershopId correto pra checagem de posse na rota", async () => {
    const plan = await getClientPlan(planA.id);
    expect(plan?.barbershopId).toBe(shopA.id);
    expect(plan?.barbershopId).not.toBe(shopB.id);
  });
});
