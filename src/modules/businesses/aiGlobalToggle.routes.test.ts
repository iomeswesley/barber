import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { prisma } from "@/lib/prisma.js";
import { hashPassword } from "@/lib/auth.js";

const { createApp } = await import("@/app.js");

// Interruptor geral de "IA Ativa" (Configurações) — diferente do toggle por
// conversa (aba Mensagens, ChatSession.aiPaused). Ver comentário no schema
// (Business.aiGloballyPaused) e sendMessage (chatEngine.ts).
describe("GET/PUT /api/manage/ai-global-toggle", () => {
  const app = createApp();
  const PASSWORD = "senha-de-teste-ai-global-toggle";
  let business: { id: number };
  let username: string;

  beforeAll(async () => {
    business = await prisma.business.create({ data: { name: "[teste] AI Global Toggle" } });
    username = `teste-ai-global-toggle-${business.id}`;
    await prisma.user.create({
      data: { businessId: business.id, role: "owner", username, passwordHash: hashPassword(PASSWORD), name: "[teste] Dono" },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { businessId: business.id } });
    await prisma.user.deleteMany({ where: { businessId: business.id } });
    await prisma.business.deleteMany({ where: { id: business.id } });
  });

  async function loginAgent() {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ username, password: PASSWORD });
    expect(login.status).toBe(200);
    return agent;
  }

  it("exige login", async () => {
    const res = await request(app).get("/api/manage/ai-global-toggle");
    expect(res.status).toBe(401);
  });

  it("começa desligado (false) por padrão", async () => {
    const agent = await loginAgent();
    const res = await agent.get("/api/manage/ai-global-toggle");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ paused: false });
  });

  it("liga, confirma no GET, depois desliga de novo", async () => {
    const agent = await loginAgent();

    const on = await agent.put("/api/manage/ai-global-toggle").send({ paused: true });
    expect(on.status).toBe(200);
    expect(on.body).toEqual({ paused: true });

    const check = await agent.get("/api/manage/ai-global-toggle");
    expect(check.body).toEqual({ paused: true });

    const off = await agent.put("/api/manage/ai-global-toggle").send({ paused: false });
    expect(off.body).toEqual({ paused: false });
  });

  it("registra no log de auditoria", async () => {
    const agent = await loginAgent();
    await agent.put("/api/manage/ai-global-toggle").send({ paused: true });

    const logs = await prisma.auditLog.findMany({ where: { businessId: business.id }, orderBy: { createdAt: "desc" }, take: 1 });
    expect(logs[0]?.action).toBe("Desativou a IA em todas as conversas");
  });
});
