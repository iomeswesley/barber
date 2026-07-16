import { Router } from "express";
import { requireAuth } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { savePushSubscription, deletePushSubscriptionByEndpoint } from "./push.repository.js";
import { VAPID_PUBLIC } from "./push.service.js";

export const pushRouter = Router();

pushRouter.get("/api/push/vapid-public-key", (_req, res) => {
  res.json({ key: VAPID_PUBLIC });
});

pushRouter.post("/api/push/subscribe", requireAuth, async (req, res, next) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      throw new AppError("endpoint e keys (p256dh, auth) são obrigatórios");
    }
    await savePushSubscription(req.session.user!.barbershopId, req.session.user!.id, {
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

pushRouter.delete("/api/push/subscribe", requireAuth, async (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) await deletePushSubscriptionByEndpoint(endpoint);
  res.json({ ok: true });
});
