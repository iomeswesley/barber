import { Router } from "express";
import { prisma } from "@/lib/prisma.js";
import { hashPassword, generateRandomPassword } from "@/lib/auth.js";
import { sendAdminGeneratedPasswordEmail } from "@/lib/email.js";
import { requireSuperAdmin } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";

export const superAdminRouter = Router();

// O login em si acontece em POST /api/auth/login (mesma rota/tela de
// dono/barbeiro) — ver auth.routes.ts. Aqui só ficam as rotas que já
// exigem sessão de super-admin.

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
