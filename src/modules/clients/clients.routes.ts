import { Router } from "express";
import { selfServiceRateLimiter, otpRateLimiter } from "@/middleware/rateLimiter.js";
import { AppError } from "@/middleware/errorHandler.js";
import { normalizePhone } from "@/lib/time.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { getClientByPhone, clientBelongsToShop, anonymizeClient } from "./clients.repository.js";
import { startPhoneVerification, confirmPhoneVerification, assertPhoneVerifiedRecently } from "./phoneVerification.service.js";

export const clientsRouter = Router();

// Início/confirmação do código OTP por WhatsApp — genérico, usado por
// qualquer fluxo público que precise confirmar que quem está mexendo é
// dono do telefone (agendamento, exclusão LGPD, checkout de plano). O
// checkout de plano tem seus próprios endpoints equivalentes
// (/api/public/client-plans/verify/*, em clientPlans.routes.ts) por
// compatibilidade com o front já existente — ambos chamam as mesmas
// funções de src/modules/clients/phoneVerification.service.ts, então o
// estado de verificação (PhoneVerification.verifiedAt) é o mesmo
// independente de qual dos dois o cliente usou.
clientsRouter.post("/api/public/verify/start", otpRateLimiter, async (req, res, next) => {
  try {
    const businessId = Number(req.body?.businessId);
    const phone = normalizePhone(req.body?.phone);
    if (!businessId || !phone) throw new AppError("Telefone e barbearia são obrigatórios");
    await startPhoneVerification(businessId, phone);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

clientsRouter.post("/api/public/verify/confirm", otpRateLimiter, async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const code = String(req.body?.code || "").trim();
    if (!phone || !code) throw new AppError("Telefone e código são obrigatórios");
    await confirmPhoneVerification(phone, code);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Direito de exclusão (LGPD) — autoatendimento público. Exige o telefone ter
// passado pelo código OTP do WhatsApp há no máximo 15 min
// (assertPhoneVerifiedRecently) antes de anonimizar — sem isso, bastava
// saber o telefone de alguém pra apagar o cadastro dela.
clientsRouter.post("/api/public/clients/data-deletion", selfServiceRateLimiter, async (req, res, next) => {
  try {
    const { businessId, phone } = req.body || {};
    const normalizedPhone = normalizePhone(phone);
    if (!businessId || !normalizedPhone) {
      throw new AppError("businessId e phone são obrigatórios");
    }
    await assertPhoneVerifiedRecently(normalizedPhone);
    const client = await getClientByPhone(normalizedPhone);
    if (!client || !(await clientBelongsToShop(client.id, Number(businessId)))) {
      throw new AppError("Nenhum cadastro encontrado para esse telefone nessa barbearia", 404);
    }
    await anonymizeClient(client.id);
    await logAudit(
      Number(businessId),
      "Cliente (autoatendimento)",
      "Solicitou exclusão de dados (LGPD)",
      `Cadastro do cliente #${client.id} anonimizado a pedido do titular`
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
