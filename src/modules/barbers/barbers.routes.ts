import { Router } from "express";
import { requireAuth, requireOwner, belongsToSession } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { toApiBarber } from "@/lib/apiMappers.js";
import {
  getBarber,
  getBarbersWithUsername,
  createBarber,
  updateBarber,
  setBarberActive,
  getBarberUser,
  createBarberUser,
  updateBarberUser,
  linkBarberToOwner,
} from "./barbers.repository.js";
import { assertBarberLimitNotExceeded } from "@/modules/billing/billing.service.js";
import { hashPassword } from "@/lib/auth.js";
import { getUserByUsername, getOwnerUserForBarbershop } from "@/modules/auth/users.repository.js";

export const barbersRouter = Router();

barbersRouter.get("/api/manage/barbers", requireAuth, requireOwner, async (req, res) => {
  const barbers = await getBarbersWithUsername(req.session.user!.barbershopId, { includeInactive: true });
  res.json(
    barbers.map((b) => ({
      ...toApiBarber(b),
      username: b.users[0]?.username ?? null,
      is_owner: b.users[0]?.role === "owner",
    }))
  );
});

// Username sempre gravado em minúsculo, consistente com o resto do sistema
// (onboarding e seed já fazem isso) — sem isso, o login (que normaliza o que
// foi digitado) não bateria com um valor salvo com maiúsculas aqui.
async function assertUsernameAvailable(username: string, ignoreUserId?: number) {
  const existing = await getUserByUsername(username);
  if (existing && existing.id !== ignoreUserId) throw new AppError("Esse nome de usuário já está em uso.", 409);
}

barbersRouter.post("/api/manage/barbers", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { name, username, password, linkToOwner, serviceCommissionPercent, productCommissionPercent, monthlyGoalCents } =
      req.body || {};
    if (!name || !String(name).trim()) throw new AppError("Nome é obrigatório");

    const barbershopId = req.session.user!.barbershopId;
    // Checa o limite do plano ANTES do de username, pra dar a mensagem mais
    // relevante primeiro quando os dois problemas coincidirem (limite do
    // Starter é o motivo mais provável de travar aqui, não conflito de nome).
    await assertBarberLimitNotExceeded(barbershopId);

    const commissionOpts = {
      serviceCommissionPercent: serviceCommissionPercent !== undefined ? Number(serviceCommissionPercent) : undefined,
      productCommissionPercent: productCommissionPercent !== undefined ? Number(productCommissionPercent) : undefined,
      monthlyGoalCents: monthlyGoalCents !== undefined ? Number(monthlyGoalCents) : undefined,
    };

    // Dono que também é barbeiro (comum): vincula ao próprio login de dono em
    // vez de criar um segundo usuário/senha que ele nunca vai usar.
    if (linkToOwner) {
      const ownerUser = await getOwnerUserForBarbershop(barbershopId);
      if (ownerUser?.barberId) throw new AppError("Sua conta já está vinculada a outro barbeiro.", 409);
      const barber = await createBarber(barbershopId, String(name).trim(), undefined, commissionOpts);
      await linkBarberToOwner(barbershopId, barber.id);
      await logAudit(barbershopId, req.session.user!.name, "Criou barbeiro (vinculado ao dono)", barber.name);
      return res.status(201).json(toApiBarber(barber));
    }

    if (!username || !String(username).trim()) throw new AppError("Usuário é obrigatório");
    if (String(password || "").length < 8) throw new AppError("A senha precisa ter pelo menos 8 caracteres");

    const trimmedUsername = String(username).trim().toLowerCase();
    await assertUsernameAvailable(trimmedUsername);

    const barber = await createBarber(
      barbershopId,
      String(name).trim(),
      { username: trimmedUsername, passwordHash: hashPassword(String(password)) },
      commissionOpts
    );
    await logAudit(barbershopId, req.session.user!.name, "Criou barbeiro", barber.name);
    res.status(201).json(toApiBarber(barber));
  } catch (err) {
    next(err);
  }
});

barbersRouter.put("/api/manage/barbers/:id", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const barberId = Number(req.params.id);
    const barber = await getBarber(barberId);
    if (!belongsToSession(req, barber)) throw new AppError("Barbeiro não encontrado", 404);
    const { name, serviceCommissionPercent, productCommissionPercent, monthlyGoalCents, username, password } = req.body || {};
    if (!name || !String(name).trim()) throw new AppError("Nome é obrigatório");
    const trimmedName = String(name).trim();

    // Usuário/senha são opcionais aqui: campo em branco = mantém como está.
    // Sem conta de acesso ainda (barbeiro cadastrado antes dessa feature
    // existir), os dois juntos são obrigatórios pra criar uma agora. Se esse
    // barbeiro é o dono vinculado (linkToOwner no cadastro), não existe
    // usuário/senha próprios pra gerenciar — as credenciais são as de dono,
    // geridas em outro lugar — então esses campos são ignorados aqui.
    const existingUser = await getBarberUser(barberId);
    const isOwnerLinked = existingUser?.role === "owner";
    const trimmedUsername = !isOwnerLinked && username ? String(username).trim().toLowerCase() : undefined;
    const effectivePassword = !isOwnerLinked ? password : undefined;
    if (trimmedUsername) await assertUsernameAvailable(trimmedUsername, existingUser?.id);
    if (effectivePassword && String(effectivePassword).length < 8) throw new AppError("A senha precisa ter pelo menos 8 caracteres");

    if (existingUser && !isOwnerLinked) {
      if (trimmedUsername || effectivePassword) {
        await updateBarberUser(existingUser.id, {
          username: trimmedUsername,
          passwordHash: effectivePassword ? hashPassword(String(effectivePassword)) : undefined,
          name: trimmedName,
        });
      }
    } else if (!existingUser && (trimmedUsername || effectivePassword)) {
      if (!trimmedUsername || !effectivePassword) {
        throw new AppError("Pra criar o acesso desse barbeiro, informe usuário e senha juntos.");
      }
      await createBarberUser(req.session.user!.barbershopId, barberId, trimmedName, trimmedUsername, hashPassword(String(effectivePassword)));
    }

    const updated = await updateBarber(barberId, trimmedName, {
      serviceCommissionPercent: serviceCommissionPercent !== undefined ? Number(serviceCommissionPercent) : undefined,
      productCommissionPercent: productCommissionPercent !== undefined ? Number(productCommissionPercent) : undefined,
      monthlyGoalCents: monthlyGoalCents !== undefined ? Number(monthlyGoalCents) : undefined,
    });
    await logAudit(
      req.session.user!.barbershopId,
      req.session.user!.name,
      "Editou barbeiro",
      `${updated.name} · comissão serviço ${updated.serviceCommissionPercent}% · comissão produto ${updated.productCommissionPercent}% · meta R$ ${Math.round(updated.monthlyGoalCents / 100)}`
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
