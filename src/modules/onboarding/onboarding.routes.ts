import { Router } from "express";
import { AppError } from "@/middleware/errorHandler.js";
import { signupRateLimiter, selfServiceRateLimiter } from "@/middleware/rateLimiter.js";
import { requireAuth } from "@/middleware/auth.js";
import { normalizePhone } from "@/lib/time.js";
import { prisma } from "@/lib/prisma.js";
import { generateVerificationToken, verificationTokenExpiry, sendVerificationEmail } from "@/lib/email.js";
import { env } from "@/config/env.js";
import { signupBarbershop } from "./onboarding.service.js";

export const onboardingRouter = Router();

const USERNAME_RE = /^[a-z0-9._-]+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

onboardingRouter.post("/api/signup", signupRateLimiter, async (req, res, next) => {
  try {
    const { shopName, ownerName, username, password, phone, email } = req.body || {};
    if (!shopName || !ownerName || !username || !password || !phone || !email) {
      throw new AppError("Nome da barbearia, seu nome, telefone, e-mail, usuário e senha são obrigatórios");
    }
    if (String(password).length < 8) {
      throw new AppError("A senha precisa ter pelo menos 8 caracteres");
    }
    if (!USERNAME_RE.test(String(username))) {
      throw new AppError("Usuário deve conter só letras, números, ponto, traço ou underline");
    }
    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone.length < 10) {
      throw new AppError("Telefone inválido — inclua o DDD");
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!EMAIL_RE.test(normalizedEmail)) {
      throw new AppError("E-mail inválido");
    }

    const { user } = await signupBarbershop({
      shopName: String(shopName).trim(),
      ownerName: String(ownerName).trim(),
      username: String(username).trim().toLowerCase(),
      password: String(password),
      phone: normalizedPhone,
      email: normalizedEmail,
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

// Público — o link vem por e-mail, sem sessão nenhuma disponível ainda
// nesse momento (a pessoa pode estar abrindo o link num dispositivo
// diferente de onde se cadastrou).
onboardingRouter.get("/api/verify-email", selfServiceRateLimiter, async (req, res) => {
  const token = String(req.query?.token || "");
  if (!token) return res.redirect("/login.html?verified=0");

  const user = await prisma.user.findUnique({ where: { emailVerificationToken: token } });
  if (!user || !user.emailVerificationExpiresAt || user.emailVerificationExpiresAt < new Date()) {
    return res.redirect("/login.html?verified=expired");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: new Date(), emailVerificationToken: null, emailVerificationExpiresAt: null },
  });
  res.redirect("/login.html?verified=1");
});

onboardingRouter.post("/api/auth/resend-verification", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.session.user!.id } });
    if (!user || !user.email) throw new AppError("Sua conta não tem e-mail cadastrado.", 400);
    if (user.emailVerifiedAt) return res.json({ ok: true, alreadyVerified: true });

    const token = generateVerificationToken();
    const expiresAt = verificationTokenExpiry();
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerificationToken: token, emailVerificationExpiresAt: expiresAt },
    });
    const verifyUrl = `${env.PUBLIC_BASE_URL || ""}/api/verify-email?token=${token}`;
    await sendVerificationEmail(user.email, user.name, verifyUrl);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
