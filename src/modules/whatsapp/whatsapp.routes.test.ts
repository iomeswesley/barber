import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { prisma } from "@/lib/prisma.js";
import { env } from "@/config/env.js";

// Mocka a IA (chatEngine.sendMessage) e o envio real de WhatsApp
// (sendWhatsappText) — o webhook fim a fim não deve chamar Anthropic nem
// mandar mensagem de verdade; só valida roteamento HTTP, assinatura e
// dedupe. verifyWebhookSignature/resolveBarbershopAccessToken continuam
// reais (importOriginal), é só o envio de fato que é substituído.
const sendMessageMock = vi.fn().mockResolvedValue("Resposta mockada da IA");
vi.mock("@/modules/chat/chatEngine.js", () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}));

const sendWhatsappTextMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/whatsapp.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/whatsapp.js")>();
  return {
    ...actual,
    sendWhatsappText: (...args: unknown[]) => sendWhatsappTextMock(...(args as Parameters<typeof actual.sendWhatsappText>)),
  };
});

const { createApp } = await import("@/app.js");

function signBody(rawBody: string): string {
  const hmac = crypto.createHmac("sha256", env.WHATSAPP_APP_SECRET!);
  return "sha256=" + hmac.update(rawBody).digest("hex");
}

function textMessagePayload(phoneNumberId: string, wamid: string, from: string, text: string) {
  return JSON.stringify({
    entry: [
      {
        id: "waba-teste",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: "Cliente Teste" }, wa_id: from }],
              messages: [{ id: wamid, from, type: "text", text: { body: text } }],
            },
          },
        ],
      },
    ],
  });
}

describe("POST/GET /api/whatsapp/webhook", () => {
  const app = createApp();
  let business: { id: number };
  const phoneNumberId = `teste-phone-${Date.now()}`;

  beforeAll(async () => {
    if (!env.WHATSAPP_APP_SECRET) throw new Error("WHATSAPP_APP_SECRET precisa estar configurado pra rodar este teste.");
    business = await prisma.business.create({
      data: { name: "[teste] Webhook WhatsApp", whatsappPhoneNumberId: phoneNumberId },
    });
  });

  afterAll(async () => {
    await prisma.processedWhatsappMessage.deleteMany({ where: { id: { startsWith: "wamid-teste-" } } });
    await prisma.business.deleteMany({ where: { id: business.id } });
  });

  beforeEach(() => {
    sendMessageMock.mockClear();
    sendWhatsappTextMock.mockClear();
  });

  describe("GET (handshake de verificação)", () => {
    it("responde o challenge quando o verify_token bate", async () => {
      const res = await request(app)
        .get("/api/whatsapp/webhook")
        .query({ "hub.mode": "subscribe", "hub.verify_token": env.WHATSAPP_VERIFY_TOKEN, "hub.challenge": "abc123" });
      expect(res.status).toBe(200);
      expect(res.text).toBe("abc123");
    });

    it("rejeita com 403 quando o verify_token não bate", async () => {
      const res = await request(app)
        .get("/api/whatsapp/webhook")
        .query({ "hub.mode": "subscribe", "hub.verify_token": "token-errado", "hub.challenge": "abc123" });
      expect(res.status).toBe(403);
    });
  });

  describe("POST (evento de mensagem)", () => {
    it("rejeita com 401 sem assinatura válida", async () => {
      const raw = textMessagePayload(phoneNumberId, "wamid-teste-1", "5511999990000", "Oi");
      const res = await request(app)
        .post("/api/whatsapp/webhook")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", "sha256=assinatura-forjada")
        .send(raw);
      expect(res.status).toBe(401);
      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it("processa mensagem de texto válida: chama a IA e responde via WhatsApp", async () => {
      const raw = textMessagePayload(phoneNumberId, "wamid-teste-2", "5511999990000", "Quero agendar um corte");
      const res = await request(app)
        .post("/api/whatsapp/webhook")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", signBody(raw))
        .send(raw);

      expect(res.status).toBe(200);
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
      expect(sendMessageMock).toHaveBeenCalledWith(business.id, "5511999990000", "Quero agendar um corte", "5511999990000", "Cliente Teste");
      expect(sendWhatsappTextMock).toHaveBeenCalledTimes(1);
      expect(sendWhatsappTextMock).toHaveBeenCalledWith(phoneNumberId, "5511999990000", "Resposta mockada da IA", undefined);
    });

    it("ignora reenvio duplicado do mesmo wamid (dedupe)", async () => {
      const raw = textMessagePayload(phoneNumberId, "wamid-teste-3", "5511999990000", "Mensagem repetida");
      const send = () =>
        request(app)
          .post("/api/whatsapp/webhook")
          .set("Content-Type", "application/json")
          .set("X-Hub-Signature-256", signBody(raw))
          .send(raw);

      const first = await send();
      const second = await send();

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });

    it("mensagem que não é texto (ex: áudio) cai no aviso padrão, sem chamar a IA", async () => {
      const raw = JSON.stringify({
        entry: [
          {
            id: "waba-teste",
            changes: [
              {
                field: "messages",
                value: {
                  metadata: { phone_number_id: phoneNumberId },
                  messages: [{ id: "wamid-teste-4", from: "5511999990000", type: "audio" }],
                },
              },
            ],
          },
        ],
      });
      const res = await request(app)
        .post("/api/whatsapp/webhook")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", signBody(raw))
        .send(raw);

      expect(res.status).toBe(200);
      expect(sendMessageMock).not.toHaveBeenCalled();
      expect(sendWhatsappTextMock).toHaveBeenCalledTimes(1);
      expect(sendWhatsappTextMock.mock.calls[0]?.[2]).toMatch(/só consigo entender mensagens de texto/i);
    });

    it("phone_number_id desconhecido: responde 200 mas não processa nada", async () => {
      const raw = textMessagePayload("phone-inexistente", "wamid-teste-5", "5511999990000", "Oi");
      const res = await request(app)
        .post("/api/whatsapp/webhook")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", signBody(raw))
        .send(raw);

      expect(res.status).toBe(200);
      expect(sendMessageMock).not.toHaveBeenCalled();
      expect(sendWhatsappTextMock).not.toHaveBeenCalled();
    });
  });
});
