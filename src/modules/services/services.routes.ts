import { Router } from "express";
import { requireAuth, requireOwner, belongsToSession } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { toApiService } from "@/lib/apiMappers.js";
import {
  getService,
  getServices,
  createService,
  updateService,
  setServiceActive,
} from "./services.repository.js";

export const servicesRouter = Router();

servicesRouter.get("/api/manage/services", requireAuth, requireOwner, async (req, res) => {
  const services = await getServices(req.session.user!.barbershopId, { includeInactive: true });
  res.json(services.map(toApiService));
});

servicesRouter.post("/api/manage/services", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { name, priceCents, durationMin } = req.body || {};
    if (!name || !String(name).trim() || !priceCents || !durationMin) {
      throw new AppError("name, priceCents e durationMin são obrigatórios");
    }
    const barbershopId = req.session.user!.barbershopId;
    const service = await createService(barbershopId, {
      name: String(name).trim(),
      priceCents: Number(priceCents),
      durationMin: Number(durationMin),
    });
    await logAudit(barbershopId, req.session.user!.name, "Criou serviço", service.name);
    res.status(201).json(toApiService(service));
  } catch (err) {
    next(err);
  }
});

servicesRouter.put("/api/manage/services/:id", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const service = await getService(Number(req.params.id));
    if (!belongsToSession(req, service)) throw new AppError("Serviço não encontrado", 404);
    const { name, priceCents, durationMin } = req.body || {};
    if (!name || !String(name).trim() || !priceCents || !durationMin) {
      throw new AppError("name, priceCents e durationMin são obrigatórios");
    }
    const updated = await updateService(Number(req.params.id), {
      name: String(name).trim(),
      priceCents: Number(priceCents),
      durationMin: Number(durationMin),
    });
    await logAudit(req.session.user!.barbershopId, req.session.user!.name, "Editou serviço", updated.name);
    res.json(toApiService(updated));
  } catch (err) {
    next(err);
  }
});

servicesRouter.post("/api/manage/services/:id/active", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const service = await getService(Number(req.params.id));
    if (!belongsToSession(req, service)) throw new AppError("Serviço não encontrado", 404);
    const { active } = req.body || {};
    res.json(toApiService(await setServiceActive(Number(req.params.id), !!active)));
  } catch (err) {
    next(err);
  }
});
