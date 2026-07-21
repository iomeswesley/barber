import { Router } from "express";
import { requireAuth, requireOwner, belongsToSession } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { toApiBarber } from "@/lib/apiMappers.js";
import { getBarber, getBarbers, createBarber, updateBarber, setBarberActive } from "./barbers.repository.js";
import { assertBarberLimitNotExceeded } from "@/modules/billing/billing.service.js";
import { hashPassword } from "@/lib/auth.js";
import { getUserByUsername } from "@/modules/auth/users.repository.js";

export const barbersRouter = Router();

barbersRouter.get("/api/manage/barbers", requireAuth, requireOwner, async (req, res) => {
  const barbers = await getBarbers(req.session.user!.barbershopId, { includeInactive: true });
  res.json(barbers.map(toApiBarber));
});

barbersRouter.post("/api/manage/barbers", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { name, username, password } = req.body || {};
    if (!name || !String(name).trim()) throw new AppError("Nome é obrigatório");
    if (!username || !String(username).trim()) throw new AppError("Usuário é obrigatório");
    if (String(password || "").length < 8) throw new AppError("A senha precisa ter pelo menos 8 caracteres");

    const barbershopId = req.session.user!.barbershopId;
    // Checa o limite do plano ANTES do de username, pra dar a mensagem mais
    // relevante primeiro quando os dois problemas coincidirem (limite do
    // Starter é o motivo mais provável de travar aqui, não conflito de nome).
    await assertBarberLimitNotExceeded(barbershopId);

    const trimmedUsername = String(username).trim();
    const existingUsername = await getUserByUsername(trimmedUsername);
    if (existingUsername) throw new AppError("Esse nome de usuário já está em uso.", 409);

    const barber = await createBarber(barbershopId, String(name).trim(), {
      username: trimmedUsername,
      passwordHash: hashPassword(String(password)),
    });
    await logAudit(barbershopId, req.session.user!.name, "Criou barbeiro", barber.name);
    res.status(201).json(toApiBarber(barber));
  } catch (err) {
    next(err);
  }
});

barbersRouter.put("/api/manage/barbers/:id", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const barber = await getBarber(Number(req.params.id));
    if (!belongsToSession(req, barber)) throw new AppError("Barbeiro não encontrado", 404);
    const { name, commissionPercent, monthlyGoalCents } = req.body || {};
    if (!name || !String(name).trim()) throw new AppError("Nome é obrigatório");
    const updated = await updateBarber(Number(req.params.id), String(name).trim(), {
      commissionPercent: commissionPercent !== undefined ? Number(commissionPercent) : undefined,
      monthlyGoalCents: monthlyGoalCents !== undefined ? Number(monthlyGoalCents) : undefined,
    });
    await logAudit(
      req.session.user!.barbershopId,
      req.session.user!.name,
      "Editou barbeiro",
      `${updated.name} · comissão ${updated.commissionPercent}% · meta R$ ${Math.round(updated.monthlyGoalCents / 100)}`
    );
    res.json(toApiBarber(updated));
  } catch (err) {
    next(err);
  }
});

barbersRouter.post("/api/manage/barbers/:id/active", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const barber = await getBarber(Number(req.params.id));
    if (!belongsToSession(req, barber)) throw new AppError("Barbeiro não encontrado", 404);
    const { active } = req.body || {};
    if (active) await assertBarberLimitNotExceeded(req.session.user!.barbershopId);
    const updated = await setBarberActive(Number(req.params.id), !!active);
    await logAudit(
      req.session.user!.barbershopId,
      req.session.user!.name,
      active ? "Ativou barbeiro" : "Desativou barbeiro",
      updated.name
    );
    res.json(toApiBarber(updated));
  } catch (err) {
    next(err);
  }
});
