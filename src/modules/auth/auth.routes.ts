import { Router } from "express";
import { verifyPassword } from "@/lib/auth.js";
import { loginRateLimiter } from "@/middleware/rateLimiter.js";
import { requireAuth } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { getUserByUsername, getUserById } from "./users.repository.js";
import { getBarbershop } from "@/modules/barbershops/barbershops.repository.js";

export const authRouter = Router();

authRouter.post("/api/auth/login", loginRateLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) throw new AppError("username e password são obrigatórios");

    const user = await getUserByUsername(username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new AppError("Usuário ou senha inválidos", 401);
    }

    req.session.user = {
      id: user.id,
      role: user.role,
      barbershopId: user.barbershopId,
      barberId: user.barberId,
      name: user.name,
    };
    // Salva explicitamente e só responde depois: sem isso, uma falha no
    // store de sessão (ex: banco indisponível) responderia 200 "ok" sem
    // nenhum cookie de sessão ser de fato emitido, e o login pareceria
    // funcionar mas nunca autentica nas próximas requisições.
    req.session.save((err) => {
      if (err) return next(err);
      res.json({ ok: true, redirect: user.role === "owner" ? "/admin.html" : "/barber.html" });
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

authRouter.get("/api/auth/me", requireAuth, async (req, res) => {
  const [shop, user] = await Promise.all([
    getBarbershop(req.session.user!.barbershopId),
    getUserById(req.session.user!.id),
  ]);
  res.json({
    ...req.session.user,
    barbershopName: shop?.name || null,
    email: user?.email || null,
    emailVerified: !!user?.emailVerifiedAt,
  });
});
