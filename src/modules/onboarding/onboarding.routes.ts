import { Router } from "express";
import { AppError } from "@/middleware/errorHandler.js";
import { signupRateLimiter } from "@/middleware/rateLimiter.js";
import { signupBarbershop } from "./onboarding.service.js";

export const onboardingRouter = Router();

const USERNAME_RE = /^[a-z0-9._-]+$/i;

onboardingRouter.post("/api/signup", signupRateLimiter, async (req, res, next) => {
  try {
    const { shopName, ownerName, username, password, phone } = req.body || {};
    if (!shopName || !ownerName || !username || !password) {
      throw new AppError("Nome da barbearia, seu nome, usuário e senha são obrigatórios");
    }
    if (String(password).length < 8) {
      throw new AppError("A senha precisa ter pelo menos 8 caracteres");
    }
    if (!USERNAME_RE.test(String(username))) {
      throw new AppError("Usuário deve conter só letras, números, ponto, traço ou underline");
    }

    const { user } = await signupBarbershop({
      shopName: String(shopName).trim(),
      ownerName: String(ownerName).trim(),
      username: String(username).trim().toLowerCase(),
      password: String(password),
      phone: phone ? String(phone).trim() : undefined,
    });

    req.session.user = {
      id: user.id,
      role: user.role,
      barbershopId: user.barbershopId,
      barberId: user.barberId,
      name: user.name,
    };
    req.session.save((err) => {
      if (err) return next(err);
      res.status(201).json({ ok: true, redirect: "/admin.html" });
    });
  } catch (err) {
    next(err);
  }
});
