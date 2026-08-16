import { Router } from "express";
import { chatRateLimiter } from "@/middleware/rateLimiter.js";
import { requireAuth, requireOwner } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { normalizePhone } from "@/lib/time.js";
import { getBarbershop } from "@/modules/businesses/businesses.repository.js";
import { getClientByPhone } from "@/modules/clients/clients.repository.js";
import {
  sendMessage,
  resetSession,
  listChatSessionsForBarbershop,
  getChatTranscript,
  sendManualMessage,
  sendManualAttachment,
  setAiPaused,
} from "./chatEngine.js";

export const chatRouter = Router();

chatRouter.post("/api/chat", chatRateLimiter, async (req, res, next) => {
  try {
    const { businessId, sessionId, message, customerPhone, pushName } = req.body || {};
    if (!businessId || !sessionId || !message || !customerPhone) {
      throw new AppError("businessId, sessionId, message e customerPhone são obrigatórios");
    }
    const shop = await getBarbershop(Number(businessId));
    if (!shop) throw new AppError("Barbearia não encontrada", 404);

    // Numa integração real de WhatsApp, o telefone chega já normalizado (wa_id).
    // Aqui normalizamos o que o simulador envia pra manter a identificação do cliente consistente.
    const normalizedPhone = normalizePhone(customerPhone);
    if (!normalizedPhone) throw new AppError("customerPhone inválido");

    const reply = await sendMessage(Number(businessId), sessionId, message, normalizedPhone, pushName);
    res.json({ reply });
  } catch (err) {
    next(err);
  }
});

chatRouter.post("/api/chat/reset", async (req, res, next) => {
  try {
    const { sessionId, businessId } = req.body || {};
    if (sessionId && businessId) await resetSession(sessionId, Number(businessId));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------------- Histórico de conversas (painel do dono) ---------------- */

chatRouter.get("/api/manage/chat-sessions", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const sessions = await listChatSessionsForBarbershop(req.session.user!.businessId);
    const withNames = await Promise.all(
      sessions.map(async (s) => {
        const client = await getClientByPhone(s.phone);
        return {
          phone: s.phone,
          clientName: client?.name || null,
          updatedAt: s.updatedAt,
          needsAttention: s.needsAttention,
          aiPaused: s.aiPaused,
          messageCount: s.messageCount,
          lastMessage: s.lastMessage,
        };
      })
    );
    res.json(withNames);
  } catch (err) {
    next(err);
  }
});

chatRouter.get("/api/manage/chat-sessions/:phone", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const phone = req.params.phone;
    if (!phone) throw new AppError("Telefone é obrigatório");
    const transcript = await getChatTranscript(req.session.user!.businessId, phone);
    res.json(transcript);
  } catch (err) {
    next(err);
  }
});

// Toggle "IA Ativa" da aba Mensagens — pausar interrompe respostas
// automáticas dessa conversa (ver setAiPaused/sendMessage em chatEngine.ts).
chatRouter.post("/api/manage/chat-sessions/:phone/ai-toggle", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const phone = req.params.phone;
    if (!phone) throw new AppError("Telefone é obrigatório");
    const paused = !!req.body?.paused;
    await setAiPaused(req.session.user!.businessId, phone, paused);
    res.json({ ok: true, paused });
  } catch (err) {
    next(err);
  }
});

chatRouter.post("/api/manage/chat-sessions/:phone/send", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const phone = req.params.phone;
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!phone) throw new AppError("Telefone é obrigatório");
    if (!message) throw new AppError("Mensagem é obrigatória");
    try {
      await sendManualMessage(req.session.user!.businessId, phone, message);
    } catch (err) {
      // Falha de envio (WhatsApp não configurado, fora da janela de 24h da
      // Meta, etc.) é uma condição esperada e acionável pelo dono — não um
      // bug do sistema — então vira 400 com a mensagem original em vez de
      // 500 genérico.
      throw new AppError((err as Error).message);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Anexo (imagem/PDF) da aba Mensagens — arquivo chega como base64 no corpo
// JSON (não multipart: o projeto não tem parser de multipart instalado, e
// isso evita adicionar uma dependência nova só pra esse upload pontual).
// 15MB de limite no express.json() (ver app.ts) cobre o caso de uso real
// (documento), com folga pro overhead de ~33% do base64.
chatRouter.post("/api/manage/chat-sessions/:phone/send-attachment", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const phone = req.params.phone;
    const { fileName, mimeType, dataBase64 } = req.body || {};
    if (!phone) throw new AppError("Telefone é obrigatório");
    if (!fileName || !mimeType || !dataBase64) throw new AppError("fileName, mimeType e dataBase64 são obrigatórios");
    const buffer = Buffer.from(String(dataBase64), "base64");
    if (buffer.length > 10 * 1024 * 1024) throw new AppError("Arquivo muito grande (máximo 10MB).");
    try {
      await sendManualAttachment(req.session.user!.businessId, phone, buffer, String(mimeType), String(fileName));
    } catch (err) {
      throw new AppError((err as Error).message);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
