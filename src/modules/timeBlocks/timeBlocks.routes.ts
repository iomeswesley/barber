import { Router } from "express";
import { requireAuth, requireOwner, requireBarber, belongsToSession } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { getBarber } from "@/modules/professionals/professionals.repository.js";
import { getAffectedAppointments } from "@/modules/appointments/appointments.service.js";
import { sendRescheduleNotice } from "@/jobs/reminders.js";
import { toApiTimeBlock } from "@/lib/apiMappers.js";
import { vertical } from "@/config/env.js";
import {
  createTimeBlock,
  listTimeBlocks,
  listTimeBlocksForBarber,
  getTimeBlockById,
  updateTimeBlock,
  deleteTimeBlock,
} from "./timeBlocks.repository.js";

export const timeBlocksRouter = Router();

function validateBlockInput(body: any) {
  const { type, startTime, endTime, date, recurring } = body || {};
  if (!type || !startTime || !endTime || (!recurring && !date)) {
    throw new AppError("type, startTime, endTime são obrigatórios (e date, se não for recorrente)");
  }
}

// Um bloqueio de horário de última hora pode colidir com agendamentos já feitos
// pra essa data — isso avisa cada cliente afetado, ao invés de dar no-show
// silencioso. Bloqueios recorrentes não têm uma data única pra checar, são pulados.
async function notifyAffectedAppointments(
  businessId: number,
  { professionalId, date, startTime, endTime, recurring }: { professionalId: number | null; date?: string | null; startTime: string; endTime: string; recurring: boolean }
) {
  if (recurring || !date) return [];
  const affected = await getAffectedAppointments(businessId, professionalId, date, startTime, endTime);
  for (const appointment of affected) {
    await sendRescheduleNotice(businessId, appointment);
  }
  return affected;
}

/* ---------------- Bloqueios do próprio barbeiro ---------------- */

timeBlocksRouter.get("/api/barber/time-blocks", requireAuth, requireBarber, async (req, res) => {
  const blocks = await listTimeBlocksForBarber(req.session.user!.businessId, req.session.user!.professionalId!);
  res.json(blocks.map(toApiTimeBlock));
});

timeBlocksRouter.post("/api/barber/time-blocks", requireAuth, requireBarber, async (req, res, next) => {
  try {
    validateBlockInput(req.body);
    const { type, label, date, startTime, endTime, recurring } = req.body;
    const businessId = req.session.user!.businessId;
    const professionalId = req.session.user!.professionalId!;
    const block = await createTimeBlock(businessId, {
      professionalId,
      type,
      label,
      date,
      startTime,
      endTime,
      recurring: !!recurring,
    });
    const affected = await notifyAffectedAppointments(businessId, {
      professionalId,
      date,
      startTime,
      endTime,
      recurring: !!recurring,
    });
    await logAudit(
      businessId,
      req.session.user!.name,
      "Criou bloqueio de horário (próprio)",
      `${date || "recorrente"} ${startTime}–${endTime}${affected.length ? ` · ${affected.length} ${vertical.client}(s) avisado(s)` : ""}`
    );
    res.status(201).json({ ...toApiTimeBlock(block), affectedCount: affected.length });
  } catch (err) {
    next(err);
  }
});

timeBlocksRouter.delete("/api/barber/time-blocks/:id", requireAuth, requireBarber, async (req, res, next) => {
  try {
    const block = await getTimeBlockById(Number(req.params.id));
    if (
      !block ||
      block.businessId !== req.session.user!.businessId ||
      block.professionalId !== req.session.user!.professionalId
    ) {
      throw new AppError("Bloqueio não encontrado", 404);
    }
    await deleteTimeBlock(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------------- Bloqueios administrados pelo dono ---------------- */

timeBlocksRouter.get("/api/manage/time-blocks", requireAuth, requireOwner, async (req, res) => {
  const blocks = await listTimeBlocks(req.session.user!.businessId);
  res.json(blocks.map(toApiTimeBlock));
});

timeBlocksRouter.post("/api/manage/time-blocks", requireAuth, requireOwner, async (req, res, next) => {
  try {
    validateBlockInput(req.body);
    const { professionalId, type, label, date, startTime, endTime, recurring } = req.body;
    const businessId = req.session.user!.businessId;
    if (professionalId) {
      const barber = await getBarber(Number(professionalId));
      if (!belongsToSession(req, barber)) throw new AppError("Barbeiro inválido");
    }
    const block = await createTimeBlock(businessId, {
      professionalId: professionalId ? Number(professionalId) : null,
      type,
      label,
      date,
      startTime,
      endTime,
      recurring: !!recurring,
    });
    const affected = await notifyAffectedAppointments(businessId, {
      professionalId: professionalId ? Number(professionalId) : null,
      date,
      startTime,
      endTime,
      recurring: !!recurring,
    });
    await logAudit(
      businessId,
      req.session.user!.name,
      "Criou bloqueio de horário",
      `${date || "recorrente"} ${startTime}–${endTime}${affected.length ? ` · ${affected.length} ${vertical.client}(s) avisado(s)` : ""}`
    );
    res.status(201).json({ ...toApiTimeBlock(block), affectedCount: affected.length });
  } catch (err) {
    next(err);
  }
});

timeBlocksRouter.put("/api/manage/time-blocks/:id", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const existing = await getTimeBlockById(Number(req.params.id));
    if (!belongsToSession(req, existing)) throw new AppError("Bloqueio não encontrado", 404);
    validateBlockInput(req.body);
    const { professionalId, type, label, date, startTime, endTime, recurring } = req.body;
    if (professionalId) {
      const barber = await getBarber(Number(professionalId));
      if (!belongsToSession(req, barber)) throw new AppError("Barbeiro inválido");
    }
    const updated = await updateTimeBlock(Number(req.params.id), {
      professionalId: professionalId ? Number(professionalId) : null,
      type,
      label,
      date,
      startTime,
      endTime,
      recurring: !!recurring,
    });
    res.json(toApiTimeBlock(updated));
  } catch (err) {
    next(err);
  }
});

timeBlocksRouter.delete("/api/manage/time-blocks/:id", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const block = await getTimeBlockById(Number(req.params.id));
    if (!belongsToSession(req, block)) throw new AppError("Bloqueio não encontrado", 404);
    await deleteTimeBlock(Number(req.params.id));
    await logAudit(req.session.user!.businessId, req.session.user!.name, "Removeu bloqueio de horário", `#${block!.id}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
