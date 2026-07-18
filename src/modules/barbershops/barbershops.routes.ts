import { Router } from "express";
import { requireAuth, requireOwner } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import {
  getBarbershops,
  getBusinessHours,
  updateBusinessHours,
} from "./barbershops.repository.js";
import { getServices } from "@/modules/services/services.repository.js";
import { getBarbers } from "@/modules/barbers/barbers.repository.js";
import { toApiService, toApiBarber, toApiBusinessHours, toApiBarbershopPublic } from "@/lib/apiMappers.js";

export const barbershopsRouter = Router();

// Rotas públicas — usadas pela tela de reserva antes do cliente se identificar.
barbershopsRouter.get("/api/barbershops", async (_req, res) => {
  res.json((await getBarbershops()).map(toApiBarbershopPublic));
});

barbershopsRouter.get("/api/barbershops/:id/services", async (req, res) => {
  const services = await getServices(Number(req.params.id));
  res.json(services.map(toApiService));
});

barbershopsRouter.get("/api/barbershops/:id/barbers", async (req, res) => {
  const barbers = await getBarbers(Number(req.params.id));
  res.json(barbers.map(toApiBarber));
});

barbershopsRouter.get("/api/manage/business-hours", requireAuth, requireOwner, async (req, res) => {
  const hours = await getBusinessHours(req.session.user!.barbershopId);
  res.json(hours.map(toApiBusinessHours));
});

const WEEKDAYS = 7;

barbershopsRouter.put("/api/manage/business-hours", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { hours } = req.body || {};
    if (!Array.isArray(hours) || hours.length !== WEEKDAYS) {
      throw new AppError("hours deve ter os 7 dias da semana");
    }
    for (const h of hours) {
      if (
        typeof h.weekday !== "number" ||
        h.weekday < 0 ||
        h.weekday > 6 ||
        (!h.closed && (!h.opensAt || !h.closesAt))
      ) {
        throw new AppError("Cada dia precisa de weekday e, se não estiver fechado, opensAt/closesAt");
      }
    }
    const barbershopId = req.session.user!.barbershopId;
    const updated = await updateBusinessHours(
      barbershopId,
      hours.map((h) => ({
        weekday: h.weekday,
        opensAt: h.opensAt || "09:00",
        closesAt: h.closesAt || "18:00",
        closed: !!h.closed,
      }))
    );
    await logAudit(barbershopId, req.session.user!.name, "Alterou horário de funcionamento", "por dia da semana");
    res.json(updated.map(toApiBusinessHours));
  } catch (err) {
    next(err);
  }
});
