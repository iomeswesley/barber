import { Router } from "express";
import { requireAuth, belongsToSession } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { env } from "@/config/env.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { getBarber } from "@/modules/professionals/professionals.repository.js";
import {
  googleCalendarConfigured,
  getConnectUrl,
  getConnectStatus,
  handleOAuthCallback,
  disconnectGoogleCalendar,
} from "./googleCalendar.service.js";

export const googleCalendarRouter = Router();

const CALLBACK_PATH = "/api/manage/google-calendar/callback";

function redirectUri(req: import("express").Request): string {
  const base = env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
  return `${base}${CALLBACK_PATH}`;
}

// Dono pode conectar a agenda de qualquer barbeiro da própria barbearia
// (?professionalId=); um barbeiro logado só conecta a própria (ignora
// qualquer professionalId vindo de fora, sempre usa a da própria sessão) —
// mesmo padrão de isolamento que o resto do painel usa pra bloqueios/agenda.
async function resolveTargetProfessionalId(req: import("express").Request): Promise<number> {
  if (req.session.user!.role === "professional") {
    return req.session.user!.professionalId!;
  }
  const professionalId = Number(req.query.professionalId || req.body?.professionalId);
  if (!professionalId) throw new AppError("professionalId é obrigatório");
  const professional = await getBarber(professionalId);
  if (!belongsToSession(req, professional)) throw new AppError("Barbeiro não encontrado", 404);
  return professionalId;
}

googleCalendarRouter.get("/api/manage/google-calendar/config", requireAuth, (_req, res) => {
  res.json({ configured: googleCalendarConfigured });
});

googleCalendarRouter.get("/api/manage/google-calendar/status", requireAuth, async (req, res, next) => {
  try {
    const professionalId = await resolveTargetProfessionalId(req);
    res.json(await getConnectStatus(professionalId));
  } catch (err) {
    next(err);
  }
});

googleCalendarRouter.get("/api/manage/google-calendar/connect", requireAuth, async (req, res, next) => {
  try {
    if (!googleCalendarConfigured) throw new AppError("Integração com Google Agenda ainda não configurada.", 503);
    const professionalId = await resolveTargetProfessionalId(req);
    res.json({ url: getConnectUrl(professionalId, redirectUri(req)) });
  } catch (err) {
    next(err);
  }
});

// GET (não POST) porque é o próprio Google redirecionando o navegador de
// volta pra cá depois do consentimento — não um fetch nosso.
googleCalendarRouter.get(CALLBACK_PATH, requireAuth, async (req, res) => {
  const code = String(req.query.code || "");
  const professionalId = Number(req.query.state || "");
  if (!code || !professionalId) return res.redirect("/admin.html?google_calendar=error");
  try {
    const professional = await getBarber(professionalId);
    if (!belongsToSession(req, professional) && req.session.user!.professionalId !== professionalId) {
      return res.redirect("/admin.html?google_calendar=error");
    }
    await handleOAuthCallback(professionalId, code, redirectUri(req));
    await logAudit(req.session.user!.businessId, req.session.user!.name, "Conectou Google Agenda", `barbeiro #${professionalId}`);
    res.redirect("/admin.html?google_calendar=ok");
  } catch (err) {
    console.error("[GOOGLE CALENDAR] Falha no callback OAuth:", (err as Error).message);
    res.redirect("/admin.html?google_calendar=error");
  }
});

googleCalendarRouter.post("/api/manage/google-calendar/disconnect", requireAuth, async (req, res, next) => {
  try {
    const professionalId = await resolveTargetProfessionalId(req);
    await disconnectGoogleCalendar(professionalId);
    await logAudit(req.session.user!.businessId, req.session.user!.name, "Desconectou Google Agenda", `barbeiro #${professionalId}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
