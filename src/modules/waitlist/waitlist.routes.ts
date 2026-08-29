import { Router } from "express";
import { requireAuth, requireOwner, belongsToSession } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { toApiWaitlistEntry } from "@/lib/apiMappers.js";
import { listWaitlist, getWaitlistEntry, cancelWaitlistEntry } from "./waitlist.repository.js";

export const waitlistRouter = Router();

function toApi(w: any) {
  return toApiWaitlistEntry({
    ...w,
    clientName: w.client.name,
    clientPhone: w.client.phone,
    professionalName: w.professional?.name ?? null,
    serviceName: w.service?.name ?? null,
  });
}

waitlistRouter.get("/api/manage/waitlist", requireAuth, requireOwner, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const entries = await listWaitlist(req.session.user!.businessId, { status });
  res.json(entries.map(toApi));
});

waitlistRouter.delete("/api/manage/waitlist/:id", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const entry = await getWaitlistEntry(Number(req.params.id));
    if (!belongsToSession(req, entry)) throw new AppError("Registro não encontrado", 404);
    await cancelWaitlistEntry(entry!.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
