import { Router } from "express";
import { requireAuth, requireOwner } from "@/middleware/auth.js";
import { toApiAuditLog } from "@/lib/apiMappers.js";
import { listAuditLog } from "./auditLog.repository.js";

export const auditLogRouter = Router();

auditLogRouter.get("/api/manage/audit-log", requireAuth, requireOwner, async (req, res) => {
  const logs = await listAuditLog(req.session.user!.barbershopId);
  res.json(logs.map(toApiAuditLog));
});
