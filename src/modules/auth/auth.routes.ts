import { Router } from "express";
import { verifyPassword, hashPassword } from "@/lib/auth.js";
import { loginRateLimiter, selfServiceRateLimiter } from "@/middleware/rateLimiter.js";
import { requireAuth } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { prisma } from "@/lib/prisma.js";
import { generateVerificationToken, passwordResetTokenExpiry, sendPasswordResetEmail } from "@/lib/email.js";
import { env } from "@/config/env.js";
import { getUserByUsername, getUserById, getUserByEmail } from "./users.repository.js";
import { getBarbershop } from "@/modules/barbershops/barbershops.repository.js";

export const authRouter = Router();

authRouter.post("/api/auth/login", loginRateLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) throw new AppError("username e password são obrigatórios");
    // Usuário sempre gravado em minúsculo (onboarding, criação de barbeiro
    // e seed já fazem isso) — normaliza o que foi digitado aqui também, pra
    // "Carlos", "CARLOS" e "carlos" entrarem igual, sem exigir digitação
    // exata do jeito que ficou salvo no banco.
    const normalizedUsername = String(username).trim().toLowerCase();

    // Login do super-admin da plataforma passa pela mesma tela/rota que o
    // de dono/barbeiro — é um usuário fixo via env (ADMIN_USERNAME/
    // ADMIN_PASSWORD_HASH), não uma conta na tabela `users`, então é
    // checado à parte antes da busca normal.
    if (
      env.ADMIN_PASSWORD_HASH &&
      normalizedUsername === env.ADMIN_USERNAME.toLowerCase() &&
      verifyPassword(password, env.ADMIN_PASSWORD_HASH)
    ) {
      req.session.superAdmin = true;
      return req.session.save((err) => {
        if (err) return next(err);
        res.json({ ok: true, redirect: "/superadmin.html" });
      });
    }

    const user = await getUserByUsername(normalizedUsername);
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

// Sempre responde { ok: true }, exista ou não o e-mail — evita que a rota
// vire uma forma de descobrir se um e-mail está cadastrado no sistema
// (enumeração de contas).
authRouter.post("/api/auth/forgot-password", selfServiceRateLimiter, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) throw new AppError("E-mail é obrigatório");

    const user = await getUserByEmail(email);
    if (user) {
      const token = generateVerificationToken();
      const expiresAt = passwordResetTokenExpiry();
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordResetToken: token, passwordResetExpiresAt: expiresAt },
      });
      const resetUrl = `${env.PUBLIC_BASE_URL || ""}/redefinir-senha.html?token=${token}`;
      try {
        await sendPasswordResetEmail(user.email!, user.name, user.username, resetUrl);
      } catch (err) {
        console.error("[EMAIL] Falha ao enviar redefinição de senha:", err);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/api/auth/reset-password", selfServiceRateLimiter, async (req, res, next) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) throw new AppError("Token e nova senha são obrigatórios");
    if (String(password).length < 8) throw new AppError("A senha precisa ter pelo menos 8 caracteres");

    const user = await prisma.user.findUnique({ where: { passwordResetToken: String(token) } });
    if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
      throw new AppError("Link inválido ou expirado. Peça uma nova redefinição.", 400);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashPassword(String(password)),
        passwordResetToken: null,
        passwordResetExpiresAt: null,
      },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
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
    tourSeen: !!user?.tourSeenAt,
  });
});

// Marca o tour guiado como visto (dispensado ou concluído) — sem isso ele
// voltaria a abrir sozinho em todo login. Reabrir manualmente ("Ver tour")
// não passa por aqui.
authRouter.post("/api/auth/tour-seen", requireAuth, async (req, res, next) => {
  try {
    await prisma.user.update({ where: { id: req.session.user!.id }, data: { tourSeenAt: new Date() } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
