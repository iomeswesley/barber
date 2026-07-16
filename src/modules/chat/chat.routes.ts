import { Router } from "express";
import { chatRateLimiter } from "@/middleware/rateLimiter.js";
import { AppError } from "@/middleware/errorHandler.js";
import { normalizePhone } from "@/lib/time.js";
import { getBarbershop } from "@/modules/barbershops/barbershops.repository.js";
import { sendMessage, resetSession } from "./chatEngine.js";

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

chatRouter.post("/api/chat/reset", (req, res) => {
  const { sessionId } = req.body || {};
  if (sessionId) resetSession(sessionId);
  res.json({ ok: true });
});
