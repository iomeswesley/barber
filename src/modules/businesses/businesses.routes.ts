import { Router } from "express";
import { requireAuth, requireOwner } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import {
  getBarbershop,
  getBarbershops,
  getBusinessHours,
  updateBusinessHours,
  getToneExamples,
  updateToneExamples,
  updateAiPersonality,
  updateMasterPrompt,
  updateIcalImportUrl,
} from "./businesses.repository.js";
import { getServices } from "@/modules/services/services.repository.js";
import { getBarbers } from "@/modules/professionals/professionals.repository.js";
import { toApiService, toApiBarber, toApiBusinessHours, toApiBarbershopPublic } from "@/lib/apiMappers.js";

export const businessesRouter = Router();

// Rotas públicas — usadas pela tela de reserva antes do cliente se identificar.
businessesRouter.get("/api/barbershops", async (_req, res) => {
  res.json((await getBarbershops()).map(toApiBarbershopPublic));
});

businessesRouter.get("/api/barbershops/:id/services", async (req, res) => {
  const services = await getServices(Number(req.params.id));
  res.json(services.map(toApiService));
});

businessesRouter.get("/api/barbershops/:id/barbers", async (req, res) => {
  const barbers = await getBarbers(Number(req.params.id));
  res.json(barbers.map(toApiBarber));
});

businessesRouter.get("/api/manage/business-hours", requireAuth, requireOwner, async (req, res) => {
  const hours = await getBusinessHours(req.session.user!.businessId);
  res.json(hours.map(toApiBusinessHours));
});

const WEEKDAYS = 7;

businessesRouter.put("/api/manage/business-hours", requireAuth, requireOwner, async (req, res, next) => {
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
    const businessId = req.session.user!.businessId;
    const updated = await updateBusinessHours(
      businessId,
      hours.map((h) => ({
        weekday: h.weekday,
        opensAt: h.opensAt || "09:00",
        closesAt: h.closesAt || "18:00",
        closed: !!h.closed,
      }))
    );
    await logAudit(businessId, req.session.user!.name, "Alterou horário de funcionamento", "por dia da semana");
    res.json(updated.map(toApiBusinessHours));
  } catch (err) {
    next(err);
  }
});

// Exemplos reais de mensagens que a barbearia já mandou a clientes, usados
// como referência de tom/vocabulário pelo bot (ver buildStableSystemPrompt
// em chatEngine.ts) — self-service, sem precisar do dev pra ajustar.
const MAX_TONE_EXAMPLES = 20;
const MAX_TONE_EXAMPLE_LENGTH = 500;

businessesRouter.get("/api/manage/tone-examples", requireAuth, requireOwner, async (req, res) => {
  res.json({ examples: await getToneExamples(req.session.user!.businessId) });
});

businessesRouter.put("/api/manage/tone-examples", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { examples } = req.body || {};
    if (!Array.isArray(examples)) throw new AppError("examples deve ser uma lista de textos");
    if (examples.length > MAX_TONE_EXAMPLES) throw new AppError(`Máximo de ${MAX_TONE_EXAMPLES} exemplos`);

    const cleaned = examples
      .map((e) => (typeof e === "string" ? e.trim() : ""))
      .filter((e) => e.length > 0)
      .map((e) => e.slice(0, MAX_TONE_EXAMPLE_LENGTH));

    const businessId = req.session.user!.businessId;
    await updateToneExamples(businessId, cleaned);
    await logAudit(businessId, req.session.user!.name, "Atualizou exemplos de tom de voz da IA", `${cleaned.length} exemplo(s)`);
    res.json({ examples: cleaned });
  } catch (err) {
    next(err);
  }
});

const AI_PERSONALITY_OPTIONS = ["acolhedor", "formal", "descontraido", "tecnico"];

businessesRouter.get("/api/manage/ai-personality", requireAuth, requireOwner, async (req, res) => {
  const barbershop = await getBarbershop(req.session.user!.businessId);
  res.json({ personality: barbershop?.aiPersonality || "acolhedor" });
});

businessesRouter.put("/api/manage/ai-personality", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { personality } = req.body || {};
    if (!AI_PERSONALITY_OPTIONS.includes(personality)) {
      throw new AppError(`personality precisa ser um de: ${AI_PERSONALITY_OPTIONS.join(", ")}`);
    }
    const businessId = req.session.user!.businessId;
    await updateAiPersonality(businessId, personality);
    await logAudit(businessId, req.session.user!.name, "Alterou personalidade da IA", personality);
    res.json({ personality });
  } catch (err) {
    next(err);
  }
});

const MASTER_PROMPT_MAX_LENGTH = 4000;

businessesRouter.get("/api/manage/master-prompt", requireAuth, requireOwner, async (req, res) => {
  const barbershop = await getBarbershop(req.session.user!.businessId);
  res.json({ master_prompt: barbershop?.masterPrompt || "" });
});

businessesRouter.put("/api/manage/master-prompt", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const text = typeof req.body?.masterPrompt === "string" ? req.body.masterPrompt.trim() : "";
    if (text.length > MASTER_PROMPT_MAX_LENGTH) {
      throw new AppError(`O Prompt Mestre pode ter no máximo ${MASTER_PROMPT_MAX_LENGTH} caracteres`);
    }
    const businessId = req.session.user!.businessId;
    await updateMasterPrompt(businessId, text || null);
    await logAudit(businessId, req.session.user!.name, "Editou o Prompt Mestre da IA", text ? `${text.length} caracteres` : "removido");
    res.json({ master_prompt: text });
  } catch (err) {
    next(err);
  }
});

// URL de calendário externo (.ics) — importado 1x/dia (src/jobs/icalImport.ts,
// piggyback no cron de lembretes) e virado bloqueio de horário.
businessesRouter.get("/api/manage/ical-import-url", requireAuth, requireOwner, async (req, res) => {
  const barbershop = await getBarbershop(req.session.user!.businessId);
  res.json({ ical_import_url: barbershop?.icalImportUrl || "" });
});

businessesRouter.put("/api/manage/ical-import-url", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const url = typeof req.body?.icalImportUrl === "string" ? req.body.icalImportUrl.trim() : "";
    if (url && !/^https?:\/\//i.test(url)) {
      throw new AppError("A URL do calendário precisa começar com http:// ou https://");
    }
    const businessId = req.session.user!.businessId;
    await updateIcalImportUrl(businessId, url || null);
    await logAudit(businessId, req.session.user!.name, "Alterou URL de importação de calendário (iCal)", url || "removida");
    res.json({ ical_import_url: url });
  } catch (err) {
    next(err);
  }
});
