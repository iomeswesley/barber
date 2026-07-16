import { Router } from "express";
import { requireAuth, requireOwner, requireBarber, belongsToSession } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { getBarber } from "@/modules/barbers/barbers.repository.js";
import { getAffectedAppointments } from "@/modules/appointments/appointments.service.js";
import { sendWhatsAppMessage, buildRescheduleNoticeText } from "@/jobs/reminders.js";
import { toApiTimeBlock } from "@/lib/apiMappers.js";
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
  barbershopId: number,
  { barberId, date, startTime, endTime, recurring }: { barberId: number | null; date?: string | null; startTime: string; endTime: string; recurring: boolean }
) {
  if (recurring || !date) return [];
  const affected = await getAffectedAppointments(barbershopId, barberId, date, startTime, endTime);
  for (const appointment of affected) {
    sendWhatsAppMessage(appointment.clientPhone, buildRescheduleNoticeText(appointment));
  }
  return affected;
}

/* ---------------- Bloqueios do próprio barbeiro ---------------- */

timeBlocksRouter.get("/api/barber/time-blocks", requireAuth, requireBarber, async (req, res) => {
  const blocks = await listTimeBlocksForBarber(req.session.user!.barbershopId, req.session.user!.barberId!);
  res.json(blocks.map(toApiTimeBlock));
});

timeBlocksRouter.post("/api/barber/time-blocks", requireAuth, requireBarber, async (req, res, next) => {
  try {
    validateBlockInput(req.body);
    const { type, label, date, startTime, endTime, recurring } = req.body;
    const barbershopId = req.session.user!.barbershopId;
    const barberId = req.session.user!.barberId!;
    const block = await createTimeBlock(barbershopId, {
      barberId,
      type,
      label,
      date,
      startTime,
      endTime,
      recurring: !!recurring,
    });
    const affected = await notifyAffectedAppointments(barbershopId, {
      barberId,
      date,
      startTime,
      endTime,
      recurring: !!recurring,
    });
    await logAudit(
      barbershopId,
      req.session.user!.name,
      "Criou bloqueio de horário (próprio)",
      `${date || "recorrente"} ${startTime}–${endTime}${affected.length ? ` · ${affected.length} cliente(s) avisado(s)` : ""}`
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
      block.barbershopId !== req.session.user!.barbershopId ||
      block.barberId !== req.session.user!.barberId
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
  const blocks = await listTimeBlocks(req.session.user!.barbershopId);
  res.json(blocks.map(toApiTimeBlock));
});

timeBlocksRouter.post("/api/manage/time-blocks", requireAuth, requireOwner, async (req, res, next) => {
  try {
    validateBlockInput(req.body);
    const { barberId, type, label, date, startTime, endTime, recurring } = req.body;
    const barbershopId = req.session.user!.barbershopId;
    if (barberId) {
      const barber = await getBarber(Number(barberId));
      if (!belongsToSession(req, barber)) throw new AppError("Barbeiro inválido");
    }
    const block = await createTimeBlock(barbershopId, {
      barberId: barberId ? Number(barberId) : null,
      type,
      label,
      date,
      startTime,
      endTime,
      recurring: !!recurring,
    });
    const affected = await notifyAffectedAppointments(barbershopId, {
      barberId: barberId ? Number(barberId) : null,
      date,
      startTime,
      endTime,
      recurring: !!recurring,
    });
    await logAudit(
      barbershopId,
      req.session.user!.name,
      "Criou bloqueio de horário",
      `${date || "recorrente"} ${startTime}–${endTime}${affected.length ? ` · ${affected.length} cliente(s) avisado(s)` : ""}`
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
    const { barberId, type, label, date, startTime, endTime, recurring } = req.body;
    if (barberId) {
      const barber = await getBarber(Number(barberId));
      if (!belongsToSession(req, barber)) throw new AppError("Barbeiro inválido");
    }
    const updated = await updateTimeBlock(Number(req.params.id), {
      barberId: barberId ? Number(barberId) : null,
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
    await logAudit(req.session.user!.barbershopId, req.session.user!.name, "Removeu bloqueio de horário", `#${block!.id}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
