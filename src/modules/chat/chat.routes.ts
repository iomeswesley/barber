import { Router } from "express";
import { chatRateLimiter } from "@/middleware/rateLimiter.js";
import { requireAuth, requireOwner } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { normalizePhone } from "@/lib/time.js";
import { getBarbershop } from "@/modules/barbershops/barbershops.repository.js";
import { getClientByPhone } from "@/modules/clients/clients.repository.js";
import { sendMessage, resetSession, listChatSessionsForBarbershop, getChatTranscript } from "./chatEngine.js";

export const chatRouter = Router();

chatRouter.post("/api/chat", chatRateLimiter, async (req, res, next) => {
  try {
    const { barbershopId, sessionId, message, customerPhone, pushName } = req.body || {};
    if (!barbershopId || !sessionId || !message || !customerPhone) {
      throw new AppError("barbershopId, sessionId, message e customerPhone são obrigatórios");
    }
    const shop = await getBarbershop(Number(barbershopId));
    if (!shop) throw new AppError("Barbearia não encontrada", 404);

    // Numa integração real de WhatsApp, o telefone chega já normalizado (wa_id).
    // Aqui normalizamos o que o simulador envia pra manter a identificação do cliente consistente.
    const normalizedPhone = normalizePhone(customerPhone);
    if (!normalizedPhone) throw new AppError("customerPhone inválido");

    const reply = await sendMessage(Number(barbershopId), sessionId, message, normalizedPhone, pushName);
    res.json({ reply });
  } catch (err) {
    next(err);
  }
});

chatRouter.post("/api/chat/reset", async (req, res, next) => {
  try {
    const { sessionId, barbershopId } = req.body || {};
    if (sessionId && barbershopId) await resetSession(sessionId, Number(barbershopId));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------------- Histórico de conversas (painel do dono) ---------------- */

chatRouter.get("/api/manage/chat-sessions", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const sessions = await listChatSessionsForBarbershop(req.session.user!.barbershopId);
    const withNames = await Promise.all(
      sessions.map(async (s) => {
        const client = await getClientByPhone(s.phone);
        return { phone: s.phone, clientName: client?.name || null, updatedAt: s.updatedAt };
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
    const transcript = await getChatTranscript(req.session.user!.barbershopId, phone);
    res.json(transcript);
  } catch (err) {
    next(err);
  }
});
