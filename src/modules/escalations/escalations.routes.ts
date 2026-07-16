import { Router } from "express";
import { requireAuth, requireOwner, belongsToSession } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { toApiEscalation } from "@/lib/apiMappers.js";
import { listEscalations, getEscalationById, resolveEscalation } from "./escalations.repository.js";

export const escalationsRouter = Router();

escalationsRouter.get("/api/manage/escalations", requireAuth, requireOwner, async (req, res) => {
  const escalations = await listEscalations(req.session.user!.barbershopId);
  res.json(escalations.map(toApiEscalation));
});

escalationsRouter.post("/api/manage/escalations/:id/resolve", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const escalation = await getEscalationById(Number(req.params.id));
    if (!belongsToSession(req, escalation)) throw new AppError("Escalonamento não encontrado", 404);
    const resolved = await resolveEscalation(escalation!.id);
    res.json(toApiEscalation(resolved));
  } catch (err) {
    next(err);
  }
});
