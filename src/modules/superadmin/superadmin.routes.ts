import { Router } from "express";
import { env } from "@/config/env.js";
import { prisma } from "@/lib/prisma.js";
import { verifyPassword, hashPassword, generateRandomPassword } from "@/lib/auth.js";
import { sendAdminGeneratedPasswordEmail } from "@/lib/email.js";
import { requireSuperAdmin } from "@/middleware/auth.js";
import { loginRateLimiter } from "@/middleware/rateLimiter.js";
import { AppError } from "@/middleware/errorHandler.js";

export const superAdminRouter = Router();

// Login fixo via variável de ambiente (ADMIN_USERNAME/ADMIN_PASSWORD_HASH),
// não uma conta na tabela `users` — o painel de super-admin é da plataforma,
// não de uma barbearia específica. Reaproveita o mesmo rate limiter do
// login normal (por IP+username).
superAdminRouter.post("/api/superadmin/login", loginRateLimiter, async (req, res, next) => {
  try {
    if (!env.ADMIN_PASSWORD_HASH) {
      throw new AppError("Painel de administração não configurado", 503);
    }
    const { username, password } = req.body || {};
    if (!username || !password) throw new AppError("username e password são obrigatórios");

    const validUsername = username === env.ADMIN_USERNAME;
    const validPassword = verifyPassword(String(password), env.ADMIN_PASSWORD_HASH);
    if (!validUsername || !validPassword) {
      throw new AppError("Usuário ou senha inválidos", 401);
    }

    req.session.superAdmin = true;
    req.session.save((err) => {
      if (err) return next(err);
      res.json({ ok: true, redirect: "/superadmin.html" });
    });
  } catch (err) {
    next(err);
  }
});

superAdminRouter.post("/api/superadmin/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

superAdminRouter.get("/api/superadmin/me", requireSuperAdmin, (_req, res) => {
  res.json({ ok: true });
});

// Lista todos os usuários de todas as barbearias (donos e barbeiros) — visão
// só de leitura, sem nenhum dado de agenda/cliente/faturamento.
superAdminRouter.get("/api/superadmin/users", requireSuperAdmin, async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      include: { barbershop: { select: { name: true } } },
      orderBy: [{ barbershop: { name: "asc" } }, { role: "asc" }],
    });
    res.json(
      users.map((u) => ({
        id: u.id,
        name: u.name,
        username: u.username,
        email: u.email,
        role: u.role,
        barbershopName: u.barbershop.name,
        emailVerified: !!u.emailVerifiedAt,
        createdAt: u.createdAt,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// Gera uma senha aleatória, salva o hash e manda a senha em texto plano só
// pro e-mail já cadastrado do usuário — a senha nunca volta pra resposta da
// API nem fica visível no próprio painel de admin.
superAdminRouter.post("/api/superadmin/users/:id/reset-password", requireSuperAdmin, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
    if (!user) throw new AppError("Usuário não encontrado", 404);
    if (!user.email) throw new AppError("Esse usuário não tem e-mail cadastrado para receber a nova senha");

    const newPassword = generateRandomPassword();
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(newPassword) } });
    await sendAdminGeneratedPasswordEmail(user.email, user.name, newPassword);

    res.json({ ok: true, sentTo: user.email });
  } catch (err) {
    next(err);
  }
});
