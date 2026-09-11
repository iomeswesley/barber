// Debounce de resposta (ver whatsapp.routes.ts, recordIncomingMessage/
// hasNewerCustomerMessage/generateReplyFromHistory em chatEngine.ts): sem
// isso, o teste "processa mensagem de texto válida" esperaria os 20s reais
// de produção antes de responder. Setado ANTES de qualquer import (estático
// ou dinâmico) que toque @/config/env.js — o módulo parseia process.env uma
// única vez no load e fica em cache, mesma armadilha documentada em
// whatsappConnect.service.test.ts/chat.routes.test.ts. Todo import que toca
// env.ts (createApp, prisma, o próprio env) é dinâmico e vem só depois
// destas linhas.
process.env.WHATSAPP_REPLY_DEBOUNCE_MS = "30";
process.env.WHATSAPP_REPLY_DEBOUNCE_POLL_MS = "10";

import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";

// Mocka a IA (chatEngine.recordIncomingMessage/generateReplyFromHistory/
// hasNewerCustomerMessage) e o envio real de WhatsApp (sendWhatsappText) —
// o webhook fim a fim não deve chamar Anthropic nem mandar mensagem de
// verdade; só valida roteamento HTTP, assinatura, dedupe e o fluxo de
// debounce. verifyWebhookSignature/resolveBarbershopAccessToken continuam
// reais (importOriginal), é só o envio de fato que é substituído.
const recordIncomingMessageMock = vi.fn();
const generateReplyFromHistoryMock = vi.fn();
const hasNewerCustomerMessageMock = vi.fn();
vi.mock("@/modules/chat/chatEngine.js", () => ({
  recordIncomingMessage: (...args: unknown[]) => recordIncomingMessageMock(...args),
  generateReplyFromHistory: (...args: unknown[]) => generateReplyFromHistoryMock(...args),
  hasNewerCustomerMessage: (...args: unknown[]) => hasNewerCustomerMessageMock(...args),
}));

const sendWhatsappTextMock = vi.fn().mockResolvedValue(undefined);
const downloadWhatsappMediaMock = vi.fn();
vi.mock("@/lib/whatsapp.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/whatsapp.js")>();
  return {
    ...actual,
    sendWhatsappText: (...args: unknown[]) => sendWhatsappTextMock(...(args as Parameters<typeof actual.sendWhatsappText>)),
    downloadWhatsappMedia: (...args: unknown[]) => downloadWhatsappMediaMock(...args),
  };
});

const transcribeAudioMock = vi.fn();
vi.mock("@/lib/transcription.js", () => ({
  transcribeAudio: (...args: unknown[]) => transcribeAudioMock(...args),
  transcriptionConfigured: true,
}));

const { createApp } = await import("@/app.js");
const { prisma } = await import("@/lib/prisma.js");
const { env } = await import("@/config/env.js");

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

function audioMessagePayload(phoneNumberId: string, wamid: string, from: string, mediaId: string) {
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
              messages: [{ id: wamid, from, type: "audio", audio: { id: mediaId, mime_type: "audio/ogg" } }],
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
    recordIncomingMessageMock.mockReset();
    generateReplyFromHistoryMock.mockReset();
    hasNewerCustomerMessageMock.mockReset();
    sendWhatsappTextMock.mockClear();
    downloadWhatsappMediaMock.mockReset();
    transcribeAudioMock.mockReset();
    // Default do caminho feliz: grava a mensagem, ninguém mais recente
    // chega durante a espera (debounce roda até o fim), IA responde.
    recordIncomingMessageMock.mockResolvedValue({ status: "queued", queuedAt: new Date() });
    hasNewerCustomerMessageMock.mockResolvedValue(false);
    generateReplyFromHistoryMock.mockResolvedValue("Resposta mockada da IA");
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
      expect(recordIncomingMessageMock).not.toHaveBeenCalled();
    });

    it("processa mensagem de texto válida: grava, espera o debounce e responde via WhatsApp", async () => {
      const raw = textMessagePayload(phoneNumberId, "wamid-teste-2", "5511999990000", "Quero agendar um corte");
      const res = await request(app)
        .post("/api/whatsapp/webhook")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", signBody(raw))
        .send(raw);

      expect(res.status).toBe(200);
      expect(recordIncomingMessageMock).toHaveBeenCalledTimes(1);
      expect(recordIncomingMessageMock).toHaveBeenCalledWith(business.id, "5511999990000", "Quero agendar um corte", "5511999990000");
      // Debounce rodou até o fim (mock de "mensagem mais nova" sempre false).
      expect(hasNewerCustomerMessageMock).toHaveBeenCalled();
      expect(generateReplyFromHistoryMock).toHaveBeenCalledTimes(1);
      expect(generateReplyFromHistoryMock).toHaveBeenCalledWith(business.id, "5511999990000", "5511999990000", "Cliente Teste");
      expect(sendWhatsappTextMock).toHaveBeenCalledTimes(1);
      expect(sendWhatsappTextMock).toHaveBeenCalledWith(phoneNumberId, "5511999990000", "Resposta mockada da IA", undefined);
    });

    // Regressão do debounce em si: se uma mensagem mais nova chegou durante
    // a espera (hasNewerCustomerMessage volta true), esta invocação desiste
    // sem gerar nem mandar resposta — quem responde é a invocação da
    // mensagem mais nova.
    it("mensagem mais nova chegou durante a espera: desiste sem responder", async () => {
      hasNewerCustomerMessageMock.mockResolvedValue(true);
      const raw = textMessagePayload(phoneNumberId, "wamid-teste-superseded", "5511999990000", "oi");
      const res = await request(app)
        .post("/api/whatsapp/webhook")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", signBody(raw))
        .send(raw);

      expect(res.status).toBe(200);
      expect(recordIncomingMessageMock).toHaveBeenCalledTimes(1);
      expect(generateReplyFromHistoryMock).not.toHaveBeenCalled();
      expect(sendWhatsappTextMock).not.toHaveBeenCalled();
    });

    // Bloqueio de cobrança / IA pausada (recordIncomingMessage retorna
    // "immediate") não passa pelo debounce — responde (ou fica em silêncio,
    // se reply for null) na hora.
    it("recordIncomingMessage 'immediate' (ex: bloqueio de cobrança) responde sem debounce", async () => {
      recordIncomingMessageMock.mockResolvedValue({ status: "immediate", reply: "Aviso fixo de cobrança bloqueada" });
      const raw = textMessagePayload(phoneNumberId, "wamid-teste-immediate", "5511999990000", "oi");
      const res = await request(app)
        .post("/api/whatsapp/webhook")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", signBody(raw))
        .send(raw);

      expect(res.status).toBe(200);
      expect(hasNewerCustomerMessageMock).not.toHaveBeenCalled();
      expect(generateReplyFromHistoryMock).not.toHaveBeenCalled();
      expect(sendWhatsappTextMock).toHaveBeenCalledWith(phoneNumberId, "5511999990000", "Aviso fixo de cobrança bloqueada", undefined);
    });

    // Achado em produção (2026-09-08): em modo Coexistência o número
    // continua recebendo mensagem de operadora/banco/etc — sem esse
    // filtro a IA tentava agendar corte de cabelo com a Claro. Ver
    // src/lib/nonCustomerSenders.ts.
    it("remetente reconhecido como não-cliente (ex: Claro): ignora sem chamar a IA nem responder", async () => {
      const raw = JSON.stringify({
        entry: [
          {
            id: "waba-teste",
            changes: [
              {
                field: "messages",
                value: {
                  metadata: { phone_number_id: phoneNumberId },
                  contacts: [{ profile: { name: "Claro" }, wa_id: "5511988887777" }],
                  messages: [{ id: "wamid-teste-nao-cliente", from: "5511988887777", type: "text", text: { body: "Sua fatura está disponível" } }],
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
      expect(recordIncomingMessageMock).not.toHaveBeenCalled();
      expect(sendWhatsappTextMock).not.toHaveBeenCalled();
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
      expect(recordIncomingMessageMock).toHaveBeenCalledTimes(1);
    });

    it("mensagem de voz: baixa e transcreve o áudio, grava o texto transcrito", async () => {
      downloadWhatsappMediaMock.mockResolvedValue({ buffer: Buffer.from("fake-audio"), mimeType: "audio/ogg" });
      transcribeAudioMock.mockResolvedValue("quero marcar um corte amanhã de tarde");

      const raw = audioMessagePayload(phoneNumberId, "wamid-teste-audio-1", "5511999990000", "media-id-1");
      const res = await request(app)
        .post("/api/whatsapp/webhook")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", signBody(raw))
        .send(raw);

      expect(res.status).toBe(200);
      expect(downloadWhatsappMediaMock).toHaveBeenCalledWith("media-id-1", undefined);
      expect(transcribeAudioMock).toHaveBeenCalledWith(Buffer.from("fake-audio"), "audio/ogg");
      // Prefixo salvo no histórico pra dar transparência ao dono/IA de que
      // veio de um áudio, não digitado (ver whatsapp.routes.ts).
      expect(recordIncomingMessageMock).toHaveBeenCalledWith(
        business.id,
        "5511999990000",
        "[Áudio transcrito] quero marcar um corte amanhã de tarde",
        "5511999990000"
      );
      expect(sendWhatsappTextMock).toHaveBeenCalledWith(phoneNumberId, "5511999990000", "Resposta mockada da IA", undefined);
    });

    it("mensagem de voz que não dá pra transcrever: avisa e pede pra tentar de novo ou escrever", async () => {
      downloadWhatsappMediaMock.mockResolvedValue({ buffer: Buffer.from("fake-audio"), mimeType: "audio/ogg" });
      transcribeAudioMock.mockResolvedValue(null);

      const raw = audioMessagePayload(phoneNumberId, "wamid-teste-audio-2", "5511999990000", "media-id-2");
      const res = await request(app)
        .post("/api/whatsapp/webhook")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", signBody(raw))
        .send(raw);

      expect(res.status).toBe(200);
      expect(recordIncomingMessageMock).not.toHaveBeenCalled();
      expect(sendWhatsappTextMock).toHaveBeenCalledTimes(1);
      expect(sendWhatsappTextMock.mock.calls[0]?.[2]).toMatch(/não consegui entender esse áudio/i);
    });

    it("mensagem que não é texto nem áudio (ex: figurinha) cai no aviso padrão, sem chamar a IA", async () => {
      const raw = JSON.stringify({
        entry: [
          {
            id: "waba-teste",
            changes: [
              {
                field: "messages",
                value: {
                  metadata: { phone_number_id: phoneNumberId },
                  messages: [{ id: "wamid-teste-4", from: "5511999990000", type: "sticker" }],
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
      expect(recordIncomingMessageMock).not.toHaveBeenCalled();
      expect(sendWhatsappTextMock).toHaveBeenCalledTimes(1);
      expect(sendWhatsappTextMock.mock.calls[0]?.[2]).toMatch(/só consigo entender mensagens de texto ou áudio/i);
    });

    it("phone_number_id desconhecido: responde 200 mas não processa nada", async () => {
      const raw = textMessagePayload("phone-inexistente", "wamid-teste-5", "5511999990000", "Oi");
      const res = await request(app)
        .post("/api/whatsapp/webhook")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", signBody(raw))
        .send(raw);

      expect(res.status).toBe(200);
      expect(recordIncomingMessageMock).not.toHaveBeenCalled();
      expect(sendWhatsappTextMock).not.toHaveBeenCalled();
    });
  });
});
