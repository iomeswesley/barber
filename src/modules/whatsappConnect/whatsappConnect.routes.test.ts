import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { prisma } from "@/lib/prisma.js";
import { hashPassword } from "@/lib/auth.js";

// Mocka a camada de rede com a Meta (whatsappConnect.service.ts) — cobre a
// lógica de negócio (branch Coexistence vs normal) sem chamada de rede real.
// whatsappConnectConfigured:true fixo aqui porque este ambiente de dev/teste
// não necessariamente tem WHATSAPP_APP_ID/CONFIG_ID/APP_SECRET configurados.
const exchangeCodeForTokenMock = vi.fn();
const generateRegistrationPinMock = vi.fn();
const registerPhoneNumberMock = vi.fn();
const subscribeAppToWabaMock = vi.fn();
const getDisplayPhoneNumberMock = vi.fn();
const createTemplatesMock = vi.fn();
vi.mock("./whatsappConnect.service.js", () => ({
  whatsappConnectConfigured: true,
  exchangeCodeForToken: (...args: [string]) => exchangeCodeForTokenMock(...args),
  generateRegistrationPin: (...args: []) => generateRegistrationPinMock(...args),
  registerPhoneNumber: (...args: [string, string, string]) => registerPhoneNumberMock(...args),
  subscribeAppToWaba: (...args: [string, string]) => subscribeAppToWabaMock(...args),
  getDisplayPhoneNumber: (...args: [string, string]) => getDisplayPhoneNumberMock(...args),
  createTemplates: (...args: [string, string]) => createTemplatesMock(...args),
}));

const { createApp } = await import("@/app.js");

describe("rotas de /api/manage/whatsapp/connect (Coexistence vs normal)", () => {
  const PASSWORD = "senha-de-teste-whatsapp-connect";
  let business: { id: number };
  let username: string;

  beforeAll(async () => {
    business = await prisma.business.create({ data: { name: "[teste] WhatsApp Connect HTTP" } });
    username = `teste-wconnect-${business.id}`;
    await prisma.user.create({
      data: { businessId: business.id, role: "owner", username, passwordHash: hashPassword(PASSWORD), name: "[teste] Dono" },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { businessId: business.id } });
    await prisma.user.deleteMany({ where: { businessId: business.id } });
    await prisma.business.deleteMany({ where: { id: business.id } });
  });

  beforeEach(async () => {
    exchangeCodeForTokenMock.mockReset();
    generateRegistrationPinMock.mockReset();
    registerPhoneNumberMock.mockReset();
    subscribeAppToWabaMock.mockReset();
    getDisplayPhoneNumberMock.mockReset();
    createTemplatesMock.mockReset();
    createTemplatesMock.mockResolvedValue([]);
    subscribeAppToWabaMock.mockResolvedValue(undefined);
    // Reseta a conexão antes de cada teste, pra não vazar estado entre eles.
    await prisma.business.update({
      where: { id: business.id },
      data: {
        whatsappWabaId: null,
        whatsappPhoneNumberId: null,
        whatsappAccessTokenEnc: null,
        whatsappPinEnc: null,
        whatsappDisplayPhone: null,
        whatsappConnectionStatus: "not_connected",
        whatsappCoexistence: false,
      },
    });
  });

  async function loginAgent() {
    const agent = request.agent(createApp());
    const login = await agent.post("/api/auth/login").send({ username, password: PASSWORD });
    expect(login.status).toBe(200);
    return agent;
  }

  it("Coexistence (is_coexistence:true): não gera PIN nem chama registerPhoneNumber, salva coexistence:true", async () => {
    exchangeCodeForTokenMock.mockResolvedValue("access-token-coex");
    getDisplayPhoneNumberMock.mockResolvedValue("+55 11 90000-0001");
    const agent = await loginAgent();

    const res = await agent.post("/api/manage/whatsapp/connect/callback").send({
      code: "code-coex",
      waba_id: "waba-coex-1",
      phone_number_id: "phone-coex-1",
      is_coexistence: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.coexistence).toBe(true);
    expect(generateRegistrationPinMock).not.toHaveBeenCalled();
    expect(registerPhoneNumberMock).not.toHaveBeenCalled();
    expect(subscribeAppToWabaMock).toHaveBeenCalledWith("waba-coex-1", "access-token-coex");

    const saved = await prisma.business.findUnique({ where: { id: business.id } });
    expect(saved?.whatsappCoexistence).toBe(true);
    expect(saved?.whatsappPinEnc).toBeNull();
    expect(saved?.whatsappWabaId).toBe("waba-coex-1");
  });

  it("fluxo normal (sem is_coexistence): gera PIN e chama registerPhoneNumber, salva coexistence:false", async () => {
    exchangeCodeForTokenMock.mockResolvedValue("access-token-normal");
    generateRegistrationPinMock.mockReturnValue("123456");
    registerPhoneNumberMock.mockResolvedValue(undefined);
    getDisplayPhoneNumberMock.mockResolvedValue("+55 11 90000-0002");
    const agent = await loginAgent();

    const res = await agent.post("/api/manage/whatsapp/connect/callback").send({
      code: "code-normal",
      waba_id: "waba-normal-1",
      phone_number_id: "phone-normal-1",
    });

    expect(res.status).toBe(200);
    expect(res.body.coexistence).toBe(false);
    expect(registerPhoneNumberMock).toHaveBeenCalledWith("phone-normal-1", "access-token-normal", "123456");

    const saved = await prisma.business.findUnique({ where: { id: business.id } });
    expect(saved?.whatsappCoexistence).toBe(false);
    expect(saved?.whatsappPinEnc).not.toBeNull();
  });

  it("GET status reflete o flag coexistence salvo", async () => {
    exchangeCodeForTokenMock.mockResolvedValue("access-token-status");
    getDisplayPhoneNumberMock.mockResolvedValue("+55 11 90000-0003");
    const agent = await loginAgent();

    await agent.post("/api/manage/whatsapp/connect/callback").send({
      code: "code-status",
      waba_id: "waba-status-1",
      phone_number_id: "phone-status-1",
      is_coexistence: true,
    });

    const status = await agent.get("/api/manage/whatsapp/connect/status");
    expect(status.status).toBe(200);
    expect(status.body.coexistence).toBe(true);
    expect(status.body.display_phone).toBe("+55 11 90000-0003");
  });

  it("desconectar zera o flag coexistence", async () => {
    exchangeCodeForTokenMock.mockResolvedValue("access-token-disc");
    getDisplayPhoneNumberMock.mockResolvedValue("+55 11 90000-0004");
    const agent = await loginAgent();

    await agent.post("/api/manage/whatsapp/connect/callback").send({
      code: "code-disc",
      waba_id: "waba-disc-1",
      phone_number_id: "phone-disc-1",
      is_coexistence: true,
    });
    await agent.post("/api/manage/whatsapp/connect/disconnect");

    const saved = await prisma.business.findUnique({ where: { id: business.id } });
    expect(saved?.whatsappCoexistence).toBe(false);
    expect(saved?.whatsappConnectionStatus).toBe("not_connected");
  });
});
