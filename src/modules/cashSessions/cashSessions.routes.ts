import { Router } from "express";
import { requireAuth, requireOwner } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { toApiCashSession } from "@/lib/apiMappers.js";
import { getCashSessionStatus, openCashSession, closeCashSession, listSessions } from "./cashSessions.service.js";

export const cashSessionsRouter = Router();

cashSessionsRouter.get("/api/manage/cash-sessions/status", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const financialAccountId = Number(req.query.financialAccountId);
    if (!financialAccountId) throw new AppError("financialAccountId é obrigatório");
    const status = await getCashSessionStatus(req.session.user!.businessId, financialAccountId);
    if (!status.open) return res.json({ open: false });
    res.json({ open: true, session: toApiCashSession(status.session as any), expected_now_cents: status.expectedNowCents });
  } catch (err) {
    next(err);
  }
});

cashSessionsRouter.get("/api/manage/cash-sessions", requireAuth, requireOwner, async (req, res) => {
  const financialAccountId = req.query.financialAccountId ? Number(req.query.financialAccountId) : undefined;
  const sessions = await listSessions(req.session.user!.businessId, { financialAccountId });
  res.json(sessions.map(toApiCashSession));
});

cashSessionsRouter.post("/api/manage/cash-sessions/open", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { financialAccountId, openingBalanceCents } = req.body || {};
    if (!financialAccountId) throw new AppError("financialAccountId é obrigatório");
    if (openingBalanceCents === undefined || Number(openingBalanceCents) < 0) throw new AppError("openingBalanceCents é obrigatório");
    const businessId = req.session.user!.businessId;
    const session = await openCashSession(businessId, Number(financialAccountId), Number(openingBalanceCents), req.session.user!.name);
    await logAudit(businessId, req.session.user!.name, "Abriu caixa", `R$ ${(session.openingBalanceCents / 100).toFixed(2)}`);
    res.status(201).json(toApiCashSession(session));
  } catch (err) {
    next(err);
  }
});

cashSessionsRouter.post("/api/manage/cash-sessions/:id/close", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { closingBalanceCents, note } = req.body || {};
    if (closingBalanceCents === undefined || Number(closingBalanceCents) < 0) throw new AppError("closingBalanceCents é obrigatório");
    const businessId = req.session.user!.businessId;
    const session = await closeCashSession(businessId, Number(req.params.id), Number(closingBalanceCents), req.session.user!.name, note);
    const diffCents = session.closingBalanceCents! - session.expectedClosingCents!;
    await logAudit(
      businessId,
      req.session.user!.name,
      "Fechou caixa",
      `Contado R$ ${(session.closingBalanceCents! / 100).toFixed(2)} · esperado R$ ${(session.expectedClosingCents! / 100).toFixed(2)} · diferença R$ ${(diffCents / 100).toFixed(2)}`
    );
    res.json(toApiCashSession(session));
  } catch (err) {
    next(err);
  }
});
