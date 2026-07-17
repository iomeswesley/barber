import { Router } from "express";
import { requireAuth, requireOwner, requireBarber, belongsToSession } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import {
  getDashboardSummary,
  getRevenueDaily,
  getMonthlyFinancialTrend,
  getBarberPerformance,
  getTodayAppointments,
  getBarberOwnSummary,
  getAppointmentsInRange,
  getHistory,
  getOccupancyByHour,
} from "./dashboardStats.service.js";
import { getClientStats, getClientVisitHistory } from "./clientStats.service.js";
import { listReviews, getReviewStats } from "@/modules/reviews/reviews.repository.js";
import { clientBelongsToShop, updateClientBirthday, getClientById } from "@/modules/clients/clients.repository.js";
import { getBarbershop } from "@/modules/barbershops/barbershops.repository.js";
import { getClientLastAppointment } from "@/modules/appointments/appointments.service.js";
import { sendComeBackMessage } from "@/jobs/reminders.js";
import { listBackups, runBackup } from "@/jobs/backup.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { toApiAppointment, toApiReview, toApiClientStats, toApiClientVisit } from "@/lib/apiMappers.js";

export const dashboardRouter = Router();

/* ---------------- Painel do dono ---------------- */

dashboardRouter.get("/api/dashboard/summary", requireAuth, requireOwner, async (req, res) => {
  res.json(await getDashboardSummary(req.session.user!.barbershopId));
});

dashboardRouter.get("/api/dashboard/revenue", requireAuth, requireOwner, async (req, res) => {
  const range = ["week", "month", "3months"].includes(req.query.range as string) ? (req.query.range as string) : "month";
  res.json(await getRevenueDaily(req.session.user!.barbershopId, range));
});

dashboardRouter.get("/api/dashboard/revenue-trend", requireAuth, requireOwner, async (req, res) => {
  res.json(await getMonthlyFinancialTrend(req.session.user!.barbershopId, 6));
});

dashboardRouter.get("/api/dashboard/occupancy-by-hour", requireAuth, requireOwner, async (req, res) => {
  const range = ["week", "month", "3months"].includes(req.query.range as string) ? (req.query.range as string) : "month";
  const weekdayRaw = req.query.weekday;
  const weekday =
    weekdayRaw !== undefined && /^[0-6]$/.test(String(weekdayRaw)) ? Number(weekdayRaw) : undefined;
  const rows = await getOccupancyByHour(req.session.user!.barbershopId, range, weekday);
  res.json(rows.map((r) => ({ hour: r.hour, occupancy_percent: r.occupancyPercent })));
});

dashboardRouter.get("/api/dashboard/barbers", requireAuth, requireOwner, async (req, res) => {
  res.json(await getBarberPerformance(req.session.user!.barbershopId));
});

dashboardRouter.get("/api/dashboard/today", requireAuth, requireOwner, async (req, res) => {
  const appointments = await getTodayAppointments(req.session.user!.barbershopId);
  res.json(appointments.map(toApiAppointment));
});

dashboardRouter.get("/api/dashboard/reviews", requireAuth, requireOwner, async (req, res) => {
  const barbershopId = req.session.user!.barbershopId;
  const { period, barberId } = req.query;
  const filters = { period: (period as string) || undefined, barberId: barberId ? Number(barberId) : undefined };
  const recent = await listReviews(barbershopId, 20, filters);
  res.json({
    stats: await getReviewStats(barbershopId, filters),
    recent: recent.map(toApiReview),
  });
});

dashboardRouter.get("/api/dashboard/calendar", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { start, end, barberId } = req.query;
    if (!start || !end) throw new AppError("start e end são obrigatórios");
    const appointments = await getAppointmentsInRange(
      req.session.user!.barbershopId,
      barberId ? Number(barberId) : undefined,
      String(start),
      String(end)
    );
    res.json(appointments.map(toApiAppointment));
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get("/api/dashboard/history", requireAuth, requireOwner, async (req, res) => {
  const { period, barberId, month } = req.query;
  res.json(
    await getHistory(req.session.user!.barbershopId, {
      period: (period as string) || undefined,
      barberId: barberId ? Number(barberId) : undefined,
      month: (month as string) || undefined,
    })
  );
});

dashboardRouter.get("/api/dashboard/clients", requireAuth, requireOwner, async (req, res) => {
  const clients = await getClientStats(req.session.user!.barbershopId);
  res.json(clients.map(toApiClientStats));
});

dashboardRouter.get("/api/dashboard/clients/:id/visits", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const clientId = Number(req.params.id);
    const barbershopId = req.session.user!.barbershopId;
    if (!(await clientBelongsToShop(clientId, barbershopId))) {
      throw new AppError("Cliente não encontrado", 404);
    }
    const visits = await getClientVisitHistory(clientId, barbershopId, 5);
    res.json(visits.map(toApiClientVisit));
  } catch (err) {
    next(err);
  }
});

dashboardRouter.put("/api/manage/clients/:id/birthday", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const clientId = Number(req.params.id);
    if (!(await clientBelongsToShop(clientId, req.session.user!.barbershopId))) {
      throw new AppError("Cliente não encontrado", 404);
    }
    const { birthday } = req.body || {};
    res.json(await updateClientBirthday(clientId, birthday || null));
  } catch (err) {
    next(err);
  }
});

dashboardRouter.post("/api/manage/clients/:id/nudge", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const clientId = Number(req.params.id);
    const barbershopId = req.session.user!.barbershopId;
    if (!(await clientBelongsToShop(clientId, barbershopId))) {
      throw new AppError("Cliente não encontrado", 404);
    }
    const client = await getClientById(clientId);
    // Mensagem de reconquista é categoria marketing na Meta — só pode ser
    // enviada pra quem consentiu (opt-in dado ao confirmar um agendamento
    // pelo chat, ver criar_agendamento em chatEngine.ts).
    if (!client!.marketingOptIn) {
      throw new AppError("Este cliente ainda não deu consentimento para mensagens de marketing.", 409);
    }
    const shop = await getBarbershop(barbershopId);
    const lastAppointment = await getClientLastAppointment(clientId, barbershopId);
    await sendComeBackMessage(barbershopId, client!.phone, client!.name, shop?.name || "nossa barbearia", lastAppointment);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------------- Backup do banco (owner only) ---------------- */

dashboardRouter.get("/api/manage/backups", requireAuth, requireOwner, async (_req, res, next) => {
  try {
    res.json(await listBackups());
  } catch (err) {
    next(err);
  }
});

dashboardRouter.post("/api/manage/backups", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const backup = await runBackup();
    await logAudit(req.session.user!.barbershopId, req.session.user!.name, "Gerou backup manual do banco de dados", backup.name);
    res.status(201).json(backup);
  } catch (err) {
    next(err);
  }
});

/* ---------------- Painel do próprio barbeiro ---------------- */

dashboardRouter.get("/api/dashboard/my-today", requireAuth, requireBarber, async (req, res) => {
  const all = await getTodayAppointments(req.session.user!.barbershopId);
  res.json(all.filter((a) => a.barberId === req.session.user!.barberId).map(toApiAppointment));
});

dashboardRouter.get("/api/dashboard/my-summary", requireAuth, requireBarber, async (req, res) => {
  res.json(await getBarberOwnSummary(req.session.user!.barbershopId, req.session.user!.barberId!));
});

dashboardRouter.get("/api/dashboard/my-calendar", requireAuth, requireBarber, async (req, res, next) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) throw new AppError("start e end são obrigatórios");
    const appointments = await getAppointmentsInRange(req.session.user!.barbershopId, req.session.user!.barberId!, String(start), String(end));
    res.json(appointments.map(toApiAppointment));
  } catch (err) {
    next(err);
  }
});
