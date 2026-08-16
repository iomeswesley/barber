import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "@/app.js";
import { hashPassword } from "@/lib/auth.js";
import { prisma } from "@/lib/prisma.js";

// Cobre requireBillingOk (src/middleware/billing.ts): assinatura cancelada
// trava rotas de painel com 402, mas nunca as rotas de billing em si (senão
// não haveria como escolher um plano pra se destravar). trialing/active
// seguem liberados normalmente.
describe("requireBillingOk (bloqueio real por assinatura cancelada)", () => {
  const app = createApp();
  const PASSWORD = "senha-de-teste-billing-gate";
  let business: { id: number };
  let username: string;

  beforeAll(async () => {
    business = await prisma.business.create({ data: { name: "[teste] Billing Gate" } });
    username = `teste-billing-gate-${business.id}`;
    await prisma.user.create({
      data: { businessId: business.id, role: "owner", username, passwordHash: hashPassword(PASSWORD), name: "[teste] Dono" },
    });
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { businessId: business.id } });
    await prisma.user.deleteMany({ where: { businessId: business.id } });
    await prisma.business.deleteMany({ where: { id: business.id } });
  });

  async function loginAgent() {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ username, password: PASSWORD });
    expect(login.status).toBe(200);
    return agent;
  }

  it("sem linha de Subscription (barbearia de demonstração/legada), painel segue liberado", async () => {
    const agent = await loginAgent();
    const res = await agent.get("/api/dashboard/summary");
    expect(res.status).not.toBe(402);
  });

  it("trialing e active seguem liberados", async () => {
    const agent = await loginAgent();
    for (const status of ["trialing", "active"] as const) {
      await prisma.subscription.upsert({
        where: { businessId: business.id },
        update: { status },
        create: { businessId: business.id, status },
      });
      const res = await agent.get("/api/dashboard/summary");
      expect(res.status).not.toBe(402);
    }
  });

  it("canceled bloqueia rotas de painel com 402", async () => {
    await prisma.subscription.upsert({
      where: { businessId: business.id },
      update: { status: "canceled" },
      create: { businessId: business.id, status: "canceled" },
    });
    const agent = await loginAgent();

    const dashboard = await agent.get("/api/dashboard/summary");
    expect(dashboard.status).toBe(402);
    expect(dashboard.body.error).toBe("billing_blocked");

    const barbers = await agent.get("/api/manage/barbers");
    expect(barbers.status).toBe(402);
  });

  it("canceled continua liberando as próprias rotas de billing e auth (senão não dá pra se destravar)", async () => {
    await prisma.subscription.upsert({
      where: { businessId: business.id },
      update: { status: "canceled" },
      create: { businessId: business.id, status: "canceled" },
    });
    const agent = await loginAgent();

    const status = await agent.get("/api/billing/status");
    expect(status.status).toBe(200);
    expect(status.body.status).toBe("canceled");

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);

    const logout = await agent.post("/api/auth/logout");
    expect(logout.status).toBe(200);
  });
});
