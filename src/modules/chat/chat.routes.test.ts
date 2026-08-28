import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { prisma } from "@/lib/prisma.js";
import { hashPassword } from "@/lib/auth.js";

// Mocka só sendMessage (chamaria a Anthropic de verdade) e o envio real de
// WhatsApp (sendWhatsappText/uploadWhatsappMedia/sendWhatsappMedia) — o
// resto do chatEngine (resetSession, listChatSessionsForBarbershop,
// getChatTranscript, setAiPaused, sendManualMessage/sendManualAttachment)
// continua real, batendo no banco de verdade, mesmo padrão dos outros
// testes HTTP do projeto (ver whatsapp.routes.test.ts).
const sendMessageMock = vi.fn().mockResolvedValue("Resposta mockada da IA");
vi.mock("@/modules/chat/chatEngine.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./chatEngine.js")>();
  return { ...actual, sendMessage: (...args: unknown[]) => sendMessageMock(...(args as Parameters<typeof actual.sendMessage>)) };
});

const sendWhatsappTextMock = vi.fn().mockResolvedValue(undefined);
const uploadWhatsappMediaMock = vi.fn().mockResolvedValue("media-id-teste");
const sendWhatsappMediaMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/whatsapp.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/whatsapp.js")>();
  return {
    ...actual,
    sendWhatsappText: (...args: unknown[]) => sendWhatsappTextMock(...(args as Parameters<typeof actual.sendWhatsappText>)),
    uploadWhatsappMedia: (...args: unknown[]) => uploadWhatsappMediaMock(...(args as Parameters<typeof actual.uploadWhatsappMedia>)),
    sendWhatsappMedia: (...args: unknown[]) => sendWhatsappMediaMock(...(args as Parameters<typeof actual.sendWhatsappMedia>)),
  };
});

const { createApp } = await import("@/app.js");

describe("rotas de /api/chat e /api/manage/chat-sessions", () => {
  const app = createApp();
  const PASSWORD = "senha-de-teste-chat-routes";
  let business: { id: number };
  let username: string;
  const customerPhone = `5511999${Date.now().toString().slice(-6)}`;

  beforeAll(async () => {
    business = await prisma.business.create({ data: { name: "[teste] Chat Routes HTTP" } });
    username = `teste-chat-routes-${business.id}`;
    await prisma.user.create({
      data: { businessId: business.id, role: "owner", username, passwordHash: hashPassword(PASSWORD), name: "[teste] Dono" },
    });
  });

  afterAll(async () => {
    await prisma.chatSession.deleteMany({ where: { businessId: business.id } });
    await prisma.client.deleteMany({ where: { phone: customerPhone } });
    await prisma.user.deleteMany({ where: { businessId: business.id } });
    await prisma.business.deleteMany({ where: { id: business.id } });
  });

  beforeEach(() => {
    sendMessageMock.mockClear();
    sendWhatsappTextMock.mockClear();
    uploadWhatsappMediaMock.mockClear();
    sendWhatsappMediaMock.mockClear();
  });

  async function loginAgent() {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ username, password: PASSWORD });
    expect(login.status).toBe(200);
    return agent;
  }

  describe("POST /api/chat", () => {
    it("400 quando falta campo obrigatório", async () => {
      const res = await request(app).post("/api/chat").send({ businessId: business.id, sessionId: "s1", message: "Oi" });
      expect(res.status).toBe(400);
      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it("404 quando a barbearia não existe", async () => {
      const res = await request(app)
        .post("/api/chat")
        .send({ businessId: 999999999, sessionId: "s1", message: "Oi", customerPhone });
      expect(res.status).toBe(404);
    });

    it("400 quando o telefone é inválido", async () => {
      const res = await request(app)
        .post("/api/chat")
        .send({ businessId: business.id, sessionId: "s1", message: "Oi", customerPhone: "abc" });
      expect(res.status).toBe(400);
    });

    it("chama sendMessage com o telefone normalizado e devolve a resposta", async () => {
      const res = await request(app).post("/api/chat").send({
        businessId: business.id,
        sessionId: "sessao-teste-1",
        message: "Quero agendar um corte",
        customerPhone: "(11) 99999-0001",
        pushName: "Cliente Teste",
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ reply: "Resposta mockada da IA" });
      expect(sendMessageMock).toHaveBeenCalledWith(business.id, "sessao-teste-1", "Quero agendar um corte", "11999990001", "Cliente Teste");
    });
  });

  describe("POST /api/chat/reset", () => {
    it("apaga a sessão gravada no banco", async () => {
      const sessionId = "sessao-teste-reset";
      const key = `${business.id}:${sessionId}`;
      await prisma.chatSession.create({ data: { sessionId: key, businessId: business.id, messages: [] } });

      const res = await request(app).post("/api/chat/reset").send({ sessionId, businessId: business.id });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });

      const row = await prisma.chatSession.findUnique({ where: { sessionId: key } });
      expect(row).toBeNull();
    });

    it("200 mesmo sem sessionId/businessId (no-op)", async () => {
      const res = await request(app).post("/api/chat/reset").send({});
      expect(res.status).toBe(200);
    });
  });

  describe("guard de autenticação nas rotas /api/manage/chat-sessions", () => {
    it("401 sem sessão", async () => {
      const [list, transcript, toggle, send] = await Promise.all([
        request(app).get("/api/manage/chat-sessions"),
        request(app).get(`/api/manage/chat-sessions/${customerPhone}`),
        request(app).post(`/api/manage/chat-sessions/${customerPhone}/ai-toggle`).send({ paused: true }),
        request(app).post(`/api/manage/chat-sessions/${customerPhone}/send`).send({ message: "Oi" }),
      ]);
      expect(list.status).toBe(401);
      expect(transcript.status).toBe(401);
      expect(toggle.status).toBe(401);
      expect(send.status).toBe(401);
    });
  });

  describe("GET /api/manage/chat-sessions (lista, autenticado)", () => {
    it("lista a conversa com nome do cliente resolvido pelo telefone", async () => {
      await prisma.client.create({ data: { name: "[teste] Cliente Chat", phone: customerPhone } });
      const key = `${business.id}:${customerPhone}`;
      await prisma.chatSession.upsert({
        where: { sessionId: key },
        create: {
          sessionId: key,
          businessId: business.id,
          messages: [{ role: "user", content: "Quero marcar horário" }],
        },
        update: { messages: [{ role: "user", content: "Quero marcar horário" }] },
      });

      const agent = await loginAgent();
      const res = await agent.get("/api/manage/chat-sessions");
      expect(res.status).toBe(200);
      const entry = (res.body as Array<{ phone: string; clientName: string | null }>).find((s) => s.phone === customerPhone);
      expect(entry).toBeTruthy();
      expect(entry?.clientName).toBe("[teste] Cliente Chat");
    });
  });

  describe("GET /api/manage/chat-sessions/:phone (transcrição)", () => {
    it("devolve a transcrição só com mensagens reais (sem tool_use/tool_result)", async () => {
      const res = await (await loginAgent()).get(`/api/manage/chat-sessions/${customerPhone}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining({ role: "customer", text: "Quero marcar horário" })]));
    });
  });

  describe("POST /api/manage/chat-sessions/:phone/ai-toggle", () => {
    it("pausa e reativa a IA da conversa", async () => {
      const agent = await loginAgent();

      const pause = await agent.post(`/api/manage/chat-sessions/${customerPhone}/ai-toggle`).send({ paused: true });
      expect(pause.status).toBe(200);
      expect(pause.body).toEqual({ ok: true, paused: true });
      let row = await prisma.chatSession.findUnique({ where: { sessionId: `${business.id}:${customerPhone}` } });
      expect(row?.aiPaused).toBe(true);

      const resume = await agent.post(`/api/manage/chat-sessions/${customerPhone}/ai-toggle`).send({ paused: false });
      expect(resume.status).toBe(200);
      row = await prisma.chatSession.findUnique({ where: { sessionId: `${business.id}:${customerPhone}` } });
      expect(row?.aiPaused).toBe(false);
    });
  });

  describe("POST /api/manage/chat-sessions/:phone/send (mensagem manual)", () => {
    it("400 quando a mensagem está vazia", async () => {
      const res = await (await loginAgent()).post(`/api/manage/chat-sessions/${customerPhone}/send`).send({ message: "   " });
      expect(res.status).toBe(400);
    });

    it("400 quando a barbearia não tem WhatsApp configurado", async () => {
      const res = await (await loginAgent()).post(`/api/manage/chat-sessions/${customerPhone}/send`).send({ message: "Confirmado!" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/WhatsApp/);
      expect(sendWhatsappTextMock).not.toHaveBeenCalled();
    });

    it("envia a mensagem manual e marca a conversa como não precisando mais de atenção", async () => {
      await prisma.business.update({ where: { id: business.id }, data: { whatsappPhoneNumberId: `teste-phone-${business.id}` } });
      const key = `${business.id}:${customerPhone}`;
      await prisma.chatSession.update({ where: { sessionId: key }, data: { needsAttention: true } });

      const res = await (await loginAgent()).post(`/api/manage/chat-sessions/${customerPhone}/send`).send({ message: "Confirmado!" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(sendWhatsappTextMock).toHaveBeenCalledWith(`teste-phone-${business.id}`, customerPhone, "Confirmado!");

      const row = await prisma.chatSession.findUnique({ where: { sessionId: key } });
      expect(row?.needsAttention).toBe(false);
    });
  });

  describe("POST /api/manage/chat-sessions/:phone/send-attachment", () => {
    it("400 quando falta algum campo obrigatório", async () => {
      const res = await (await loginAgent())
        .post(`/api/manage/chat-sessions/${customerPhone}/send-attachment`)
        .send({ fileName: "foto.jpg", mimeType: "image/jpeg" });
      expect(res.status).toBe(400);
    });

    it("400 quando o arquivo passa de 10MB", async () => {
      const big = Buffer.alloc(11 * 1024 * 1024, 1).toString("base64");
      const res = await (await loginAgent())
        .post(`/api/manage/chat-sessions/${customerPhone}/send-attachment`)
        .send({ fileName: "grande.pdf", mimeType: "application/pdf", dataBase64: big });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/muito grande/i);
      expect(uploadWhatsappMediaMock).not.toHaveBeenCalled();
    });

    it("faz upload e envia o anexo (WhatsApp já configurado no teste anterior)", async () => {
      const small = Buffer.from("conteudo de teste").toString("base64");
      const res = await (await loginAgent())
        .post(`/api/manage/chat-sessions/${customerPhone}/send-attachment`)
        .send({ fileName: "foto.jpg", mimeType: "image/jpeg", dataBase64: small });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(uploadWhatsappMediaMock).toHaveBeenCalledTimes(1);
      expect(sendWhatsappMediaMock).toHaveBeenCalledTimes(1);
    });
  });
});
