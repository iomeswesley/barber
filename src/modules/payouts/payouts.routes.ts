import { Router } from "express";
import { requireAuth, requireOwner, requireBarber, belongsToSession } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { getBarbers } from "@/modules/professionals/professionals.repository.js";
import { localDateStr } from "@/lib/time.js";
import { toApiPayout } from "@/lib/apiMappers.js";
import {
  computeCommissionForPeriod,
  findOverlappingPayout,
  createPayout,
  getPayout,
  listPayouts,
  markPayoutPaid,
  deleteOpenPayout,
} from "./payouts.repository.js";

export const payoutsRouter = Router();

// "YYYY-MM-01" até hoje (ou até o fim do mês, se o mês já acabou) — mesmo
// mês corrente que o resto do painel (dashboardStats.service.ts) usa como
// período padrão, pra bater com o que o dono já vê nos KPIs.
function currentMonthRange() {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  return { from, to: localDateStr(now) };
}

function parseDateParam(value: unknown, fallback: string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return fallback;
}

/* ---------------- Painel do dono ---------------- */

// Resumo do período (padrão: mês corrente) pra cada profissional ativo —
// quanto já dá pra fechar, e se já existe um fechamento cobrindo esse
// período (pra não oferecer "Fechar" de novo em cima do que já foi fechado).
payoutsRouter.get("/api/manage/payouts/summary", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const businessId = req.session.user!.businessId;
    const { from, to } = currentMonthRange();
    const periodStart = parseDateParam(req.query.periodStart, from);
    const periodEnd = parseDateParam(req.query.periodEnd, to);

    const barbers = await getBarbers(businessId);
    const rows = await Promise.all(
      barbers.map(async (b) => {
        const commission = await computeCommissionForPeriod(businessId, b.id, periodStart, periodEnd);
        const existing = await findOverlappingPayout(b.id, periodStart, periodEnd);
        return { ...commission, periodStart, periodEnd, existingPayout: existing ? toApiPayout({ ...existing, professional: { name: b.name } }) : null };
      })
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

payoutsRouter.get("/api/manage/payouts", requireAuth, requireOwner, async (req, res) => {
  const businessId = req.session.user!.businessId;
  const professionalId = req.query.professionalId ? Number(req.query.professionalId) : undefined;
  const payouts = await listPayouts(businessId, { professionalId });
  res.json(payouts.map(toApiPayout));
});

payoutsRouter.post("/api/manage/payouts/close", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const businessId = req.session.user!.businessId;
    const { professionalId, periodStart, periodEnd } = req.body || {};
    if (!professionalId || !periodStart || !periodEnd) {
      throw new AppError("professionalId, periodStart e periodEnd são obrigatórios");
    }
    if (String(periodStart) > String(periodEnd)) {
      throw new AppError("periodStart não pode ser depois de periodEnd");
    }

    const overlapping = await findOverlappingPayout(Number(professionalId), String(periodStart), String(periodEnd));
    if (overlapping) {
      throw new AppError("Já existe um fechamento de comissão cobrindo (parte d)esse período pra este profissional", 409);
    }

    const commission = await computeCommissionForPeriod(businessId, Number(professionalId), String(periodStart), String(periodEnd));
    const payout = await createPayout({
      businessId,
      professionalId: Number(professionalId),
      periodStart: String(periodStart),
      periodEnd: String(periodEnd),
      serviceCommissionCents: commission.serviceCommissionCents,
      productCommissionCents: commission.productCommissionCents,
      createdBy: req.session.user!.name,
    });
    await logAudit(
      businessId,
      req.session.user!.name,
      "Fechou comissão",
      `${commission.professionalName} · ${periodStart} a ${periodEnd} · R$ ${(commission.totalCommissionCents / 100).toFixed(2)}`
    );
    res.status(201).json(toApiPayout({ ...payout, professional: { name: commission.professionalName } }));
  } catch (err) {
    next(err);
  }
});

payoutsRouter.post("/api/manage/payouts/:id/pay", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const businessId = req.session.user!.businessId;
    const payout = await getPayout(Number(req.params.id));
    if (!belongsToSession(req, payout)) throw new AppError("Fechamento não encontrado", 404);
    if (payout!.status === "paid") throw new AppError("Este fechamento já foi marcado como pago");

    const { adjustmentCents, adjustmentReason, note } = req.body || {};
    const updated = await markPayoutPaid(payout!.id, {
      adjustmentCents: adjustmentCents !== undefined ? Number(adjustmentCents) : 0,
      adjustmentReason: adjustmentReason ? String(adjustmentReason) : null,
      note: note ? String(note) : null,
    });
    const totalCents = updated.serviceCommissionCents + updated.productCommissionCents + updated.adjustmentCents;
    await logAudit(
      businessId,
      req.session.user!.name,
      "Marcou comissão como paga",
      `${payout!.professional.name} · R$ ${(totalCents / 100).toFixed(2)}`
    );
    res.json(toApiPayout({ ...updated, professional: payout!.professional }));
  } catch (err) {
    next(err);
  }
});

// Desfaz um fechamento por engano — só permitido enquanto ainda está "open"
// (uma vez marcado como pago, vira histórico permanente, não se apaga).
payoutsRouter.delete("/api/manage/payouts/:id", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const payout = await getPayout(Number(req.params.id));
    if (!belongsToSession(req, payout)) throw new AppError("Fechamento não encontrado", 404);
    if (payout!.status !== "open") throw new AppError("Só é possível excluir um fechamento ainda não pago");
    await deleteOpenPayout(payout!.id);
    await logAudit(req.session.user!.businessId, req.session.user!.name, "Excluiu fechamento de comissão", payout!.professional.name);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/* ---------------- Painel do profissional ---------------- */

payoutsRouter.get("/api/payouts/my-history", requireAuth, requireBarber, async (req, res) => {
  const payouts = await listPayouts(req.session.user!.businessId, { professionalId: req.session.user!.professionalId! });
  res.json(payouts.map(toApiPayout));
});
