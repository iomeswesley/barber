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
import { getBarbershop } from "@/modules/businesses/businesses.repository.js";
import { getClientLastAppointment } from "@/modules/appointments/appointments.service.js";
import { sendComeBackMessage } from "@/jobs/reminders.js";
import { listBackups, runBackup, backupSupported } from "@/jobs/backup.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { toApiAppointment, toApiReview, toApiClientStats, toApiClientVisit } from "@/lib/apiMappers.js";
import { vertical } from "@/config/env.js";

export const dashboardRouter = Router();

/* ---------------- Painel do dono ---------------- */

dashboardRouter.get("/api/dashboard/summary", requireAuth, requireOwner, async (req, res) => {
  res.json(await getDashboardSummary(req.session.user!.businessId));
});

dashboardRouter.get("/api/dashboard/revenue", requireAuth, requireOwner, async (req, res) => {
  const range = ["week", "month", "3months"].includes(req.query.range as string) ? (req.query.range as string) : "month";
  res.json(await getRevenueDaily(req.session.user!.businessId, range));
});

dashboardRouter.get("/api/dashboard/revenue-trend", requireAuth, requireOwner, async (req, res) => {
  res.json(await getMonthlyFinancialTrend(req.session.user!.businessId, 6));
});

dashboardRouter.get("/api/dashboard/occupancy-by-hour", requireAuth, requireOwner, async (req, res) => {
  const range = ["week", "month", "3months"].includes(req.query.range as string) ? (req.query.range as string) : "month";
  const rows = await getOccupancyByHour(req.session.user!.businessId, range);
  res.json(rows.map((r) => ({ weekday: r.weekday, hour: r.hour, occupancy_percent: r.occupancyPercent })));
});

dashboardRouter.get("/api/dashboard/barbers", requireAuth, requireOwner, async (req, res) => {
  res.json(await getBarberPerformance(req.session.user!.businessId));
});

dashboardRouter.get("/api/dashboard/today", requireAuth, requireOwner, async (req, res) => {
  const appointments = await getTodayAppointments(req.session.user!.businessId);
  res.json(appointments.map(toApiAppointment));
});

dashboardRouter.get("/api/dashboard/reviews", requireAuth, requireOwner, async (req, res) => {
  const businessId = req.session.user!.businessId;
  const { period, professionalId } = req.query;
  const filters = { period: (period as string) || undefined, professionalId: professionalId ? Number(professionalId) : undefined };
  const recent = await listReviews(businessId, 20, filters);
  res.json({
    stats: await getReviewStats(businessId, filters),
    recent: recent.map(toApiReview),
  });
});

dashboardRouter.get("/api/dashboard/calendar", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { start, end, professionalId } = req.query;
    if (!start || !end) throw new AppError("start e end são obrigatórios");
    const appointments = await getAppointmentsInRange(
      req.session.user!.businessId,
      professionalId ? Number(professionalId) : undefined,
      String(start),
      String(end)
    );
    res.json(appointments.map(toApiAppointment));
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get("/api/dashboard/history", requireAuth, requireOwner, async (req, res) => {
  const { period, professionalId, month } = req.query;
  res.json(
    await getHistory(req.session.user!.businessId, {
      period: (period as string) || undefined,
      professionalId: professionalId ? Number(professionalId) : undefined,
      month: (month as string) || undefined,
    })
  );
});

dashboardRouter.get("/api/dashboard/clients", requireAuth, requireOwner, async (req, res) => {
  const clients = await getClientStats(req.session.user!.businessId);
  res.json(clients.map(toApiClientStats));
});

dashboardRouter.get("/api/dashboard/clients/:id/visits", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const clientId = Number(req.params.id);
    const businessId = req.session.user!.businessId;
    if (!(await clientBelongsToShop(clientId, businessId))) {
      throw new AppError("Cliente não encontrado", 404);
    }
    const visits = await getClientVisitHistory(clientId, businessId, 5);
    res.json(visits.map(toApiClientVisit));
  } catch (err) {
    next(err);
  }
});

dashboardRouter.put("/api/manage/clients/:id/birthday", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const clientId = Number(req.params.id);
    if (!(await clientBelongsToShop(clientId, req.session.user!.businessId))) {
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
    const businessId = req.session.user!.businessId;
    if (!(await clientBelongsToShop(clientId, businessId))) {
      throw new AppError("Cliente não encontrado", 404);
    }
    const client = await getClientById(clientId);
    // Mensagem de reconquista é categoria marketing na Meta — só pode ser
    // enviada pra quem consentiu (opt-in dado ao confirmar um agendamento
    // pelo chat, ver criar_agendamento em chatEngine.ts).
    if (!client!.marketingOptIn) {
      throw new AppError(`Este ${vertical.client} ainda não deu consentimento para mensagens de marketing.`, 409);
    }
    const shop = await getBarbershop(businessId);
    const lastAppointment = await getClientLastAppointment(clientId, businessId);
    await sendComeBackMessage(businessId, client!.phone, client!.name, shop?.name || "nossa barbearia", lastAppointment);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Dispara a mensagem de reconquista pra todos os clientes "atrasados" de uma
// vez (mesma lógica de dueStatus do nudge individual acima) — sequencial, não
// paralelo, então já fica naturalmente serializado; cada envio ainda passa
// pelo orçamento de trial e pelo opt-in de marketing dentro de
// sendComeBackMessage/tryConsumeWhatsappTrialBudget, sem limite extra por
// campanha além disso.
dashboardRouter.post("/api/manage/clients/nudge-all", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const businessId = req.session.user!.businessId;
    const overdueClients = (await getClientStats(businessId)).filter((c) => c.dueStatus === "atrasado");
    const shop = await getBarbershop(businessId);

    let sent = 0;
    let skippedNoOptIn = 0;
    for (const c of overdueClients) {
      const client = await getClientById(c.id);
      // Mensagem de reconquista é categoria marketing na Meta — só pode ser
      // enviada pra quem consentiu.
      if (!client!.marketingOptIn) {
        skippedNoOptIn++;
        continue;
      }
      const lastAppointment = await getClientLastAppointment(c.id, businessId);
      await sendComeBackMessage(businessId, client!.phone, client!.name, shop?.name || "nossa barbearia", lastAppointment);
      sent++;
    }

    await logAudit(
      businessId,
      req.session.user!.name,
      "Disparou reconquista em massa",
      `${sent} enviada(s), ${skippedNoOptIn} sem opt-in de marketing`
    );
    res.json({ sent, skippedNoOptIn, totalOverdue: overdueClients.length });
  } catch (err) {
    next(err);
  }
});

/* ---------------- Backup do banco (owner only) ---------------- */

dashboardRouter.get("/api/manage/backups", requireAuth, requireOwner, async (_req, res, next) => {
  if (!backupSupported) return res.json({ supported: false, backups: [] });
  try {
    res.json({ supported: true, backups: await listBackups() });
  } catch (err) {
    next(err);
  }
});

dashboardRouter.post("/api/manage/backups", requireAuth, requireOwner, async (req, res, next) => {
  if (!backupSupported) {
    return next(new AppError("Backup manual não é suportado neste ambiente (serverless). O Supabase já mantém backups automáticos.", 503));
  }
  try {
    const backup = await runBackup();
    await logAudit(req.session.user!.businessId, req.session.user!.name, "Gerou backup manual do banco de dados", backup.name);
    res.status(201).json(backup);
  } catch (err) {
    next(err);
  }
});

/* ---------------- Painel do próprio barbeiro ---------------- */

dashboardRouter.get("/api/dashboard/my-today", requireAuth, requireBarber, async (req, res) => {
  const all = await getTodayAppointments(req.session.user!.businessId);
  res.json(all.filter((a) => a.professionalId === req.session.user!.professionalId).map(toApiAppointment));
});

dashboardRouter.get("/api/dashboard/my-summary", requireAuth, requireBarber, async (req, res) => {
  res.json(await getBarberOwnSummary(req.session.user!.businessId, req.session.user!.professionalId!));
});

dashboardRouter.get("/api/dashboard/my-calendar", requireAuth, requireBarber, async (req, res, next) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) throw new AppError("start e end são obrigatórios");
    const appointments = await getAppointmentsInRange(req.session.user!.businessId, req.session.user!.professionalId!, String(start), String(end));
    res.json(appointments.map(toApiAppointment));
  } catch (err) {
    next(err);
  }
});
