import { Router } from "express";
import { requireAuth, requireOwner } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import {
  getBarbershops,
  getBusinessHours,
  updateBusinessHours,
  getToneExamples,
  updateToneExamples,
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

// Exemplos reais de mensagens que a barbearia já mandou a clientes, usados
// como referência de tom/vocabulário pelo bot (ver buildStableSystemPrompt
// em chatEngine.ts) — self-service, sem precisar do dev pra ajustar.
const MAX_TONE_EXAMPLES = 20;
const MAX_TONE_EXAMPLE_LENGTH = 500;

barbershopsRouter.get("/api/manage/tone-examples", requireAuth, requireOwner, async (req, res) => {
  res.json({ examples: await getToneExamples(req.session.user!.barbershopId) });
});

barbershopsRouter.put("/api/manage/tone-examples", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { examples } = req.body || {};
    if (!Array.isArray(examples)) throw new AppError("examples deve ser uma lista de textos");
    if (examples.length > MAX_TONE_EXAMPLES) throw new AppError(`Máximo de ${MAX_TONE_EXAMPLES} exemplos`);

    const cleaned = examples
      .map((e) => (typeof e === "string" ? e.trim() : ""))
      .filter((e) => e.length > 0)
      .map((e) => e.slice(0, MAX_TONE_EXAMPLE_LENGTH));

    const barbershopId = req.session.user!.barbershopId;
    await updateToneExamples(barbershopId, cleaned);
    await logAudit(barbershopId, req.session.user!.name, "Atualizou exemplos de tom de voz da IA", `${cleaned.length} exemplo(s)`);
    res.json({ examples: cleaned });
  } catch (err) {
    next(err);
  }
});
