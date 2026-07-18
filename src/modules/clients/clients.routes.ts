import { Router } from "express";
import { selfServiceRateLimiter } from "@/middleware/rateLimiter.js";
import { AppError } from "@/middleware/errorHandler.js";
import { normalizePhone } from "@/lib/time.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { getClientByPhone, clientBelongsToShop, anonymizeClient } from "./clients.repository.js";

export const clientsRouter = Router();

// Direito de exclusão (LGPD) — autoatendimento público, mesmo modelo de
// confiança das outras rotas públicas: o telefone é a identidade.
clientsRouter.post("/api/public/clients/data-deletion", selfServiceRateLimiter, async (req, res, next) => {
  try {
    const { barbershopId, phone } = req.body || {};
    const normalizedPhone = normalizePhone(phone);
    if (!barbershopId || !normalizedPhone) {
      throw new AppError("barbershopId e phone são obrigatórios");
    }
    const client = await getClientByPhone(normalizedPhone);
    if (!client || !(await clientBelongsToShop(client.id, Number(barbershopId)))) {
      throw new AppError("Nenhum cadastro encontrado para esse telefone nessa barbearia", 404);
    }
    await anonymizeClient(client.id);
    await logAudit(
      Number(barbershopId),
      "Cliente (autoatendimento)",
      "Solicitou exclusão de dados (LGPD)",
      `Cadastro do cliente #${client.id} anonimizado a pedido do titular`
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
