import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "@/app.js";
import { env } from "@/config/env.js";
import { hashPassword } from "@/lib/auth.js";
import { prisma } from "@/lib/prisma.js";

// Teste de integração HTTP: usa credenciais de admin fictícias (nunca a
// senha real de produção) sobrescrevendo env.ADMIN_USERNAME/ADMIN_PASSWORD_HASH
// só durante este arquivo, restaurado no afterAll. Cobre o guard
// requireSuperAdmin e as rotas de leitura — não exercita reset-password
// (dispararia e-mail real e trocaria senha de usuário de verdade).
describe("rotas de /api/superadmin", () => {
  const app = createApp();
  const TEST_USERNAME = "teste-super-admin";
  const TEST_PASSWORD = "senha-de-teste-nao-e-a-real";
  let originalUsername: string;
  let originalPasswordHash: string | undefined;
  let business: { id: number; name: string };

  beforeAll(async () => {
    originalUsername = env.ADMIN_USERNAME;
    originalPasswordHash = env.ADMIN_PASSWORD_HASH;
    env.ADMIN_USERNAME = TEST_USERNAME;
    env.ADMIN_PASSWORD_HASH = hashPassword(TEST_PASSWORD);

    business = await prisma.business.create({ data: { name: "[teste] Superadmin HTTP" } });
  });

  afterAll(async () => {
    env.ADMIN_USERNAME = originalUsername;
    env.ADMIN_PASSWORD_HASH = originalPasswordHash;
    await prisma.business.deleteMany({ where: { id: business.id } });
  });

  it("bloqueia rotas de superadmin sem sessão (401)", async () => {
    const [me, users, shops] = await Promise.all([
      request(app).get("/api/superadmin/me"),
      request(app).get("/api/superadmin/users"),
      request(app).get("/api/superadmin/barbershops"),
    ]);
    expect(me.status).toBe(401);
    expect(users.status).toBe(401);
    expect(shops.status).toBe(401);
  });

  it("login com usuário/barbeiro comum não vira sessão de superadmin", async () => {
    const agent = request.agent(app);
    // username/senha inexistentes — só confirma que a rota de superadmin
    // não é afetada por um login comum que falha, mantendo o guard de pé.
    await agent.post("/api/auth/login").send({ username: "usuario-que-nao-existe", password: "qualquer" });
    const res = await agent.get("/api/superadmin/me");
    expect(res.status).toBe(401);
  });

  it("login como superadmin libera as rotas de leitura", async () => {
    const agent = request.agent(app);

    const login = await agent.post("/api/auth/login").send({ username: TEST_USERNAME, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body).toEqual({ ok: true, redirect: "/superadmin.html" });

    const me = await agent.get("/api/superadmin/me");
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ ok: true });

    const users = await agent.get("/api/superadmin/users");
    expect(users.status).toBe(200);
    expect(Array.isArray(users.body)).toBe(true);

    const shops = await agent.get("/api/superadmin/barbershops");
    expect(shops.status).toBe(200);
    expect(shops.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: business.id, name: business.name })]));
  });

  it("logout derruba a sessão de superadmin", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ username: TEST_USERNAME, password: TEST_PASSWORD });
    expect((await agent.get("/api/superadmin/me")).status).toBe(200);

    const logout = await agent.post("/api/superadmin/logout");
    expect(logout.status).toBe(200);

    const me = await agent.get("/api/superadmin/me");
    expect(me.status).toBe(401);
  });

  it("rejeita plano inválido em grant-trial (validação antes de tocar no banco)", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ username: TEST_USERNAME, password: TEST_PASSWORD });

    const res = await agent.post(`/api/superadmin/barbershops/${business.id}/grant-trial`).send({ plan: "plano-invalido", days: 30 });
    expect(res.status).toBe(400);
  });
});
