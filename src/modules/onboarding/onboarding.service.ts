import { prisma } from "@/lib/prisma.js";
import { hashPassword } from "@/lib/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { generateVerificationToken, verificationTokenExpiry, sendVerificationEmail } from "@/lib/email.js";
import { env } from "@/config/env.js";

const TRIAL_DAYS = 7;
// Mesmo padrão usado no seed de demonstração: 09h-19h, fechado domingo
// (weekday 0). O dono ajusta depois pela aba de Configurações.
const DEFAULT_OPENS_AT = "09:00";
const DEFAULT_CLOSES_AT = "19:00";

export interface SignupInput {
  shopName: string;
  ownerName: string;
  username: string;
  password: string;
  phone: string;
  email: string;
}

export async function signupBarbershop(input: SignupInput) {
  const existingUsername = await prisma.user.findUnique({ where: { username: input.username } });
  if (existingUsername) throw new AppError("Esse nome de usuário já está em uso.", 409);
  const existingEmail = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingEmail) throw new AppError("Esse e-mail já está cadastrado.", 409);

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);
  const verificationToken = generateVerificationToken();
  const verificationExpiresAt = verificationTokenExpiry();

  const { barbershop, user } = await prisma.$transaction(async (tx) => {
    const barbershop = await tx.barbershop.create({
      data: { name: input.shopName, phone: input.phone },
    });

    await tx.businessHours.createMany({
      data: Array.from({ length: 7 }, (_, weekday) => ({
        barbershopId: barbershop.id,
        weekday,
        opensAt: DEFAULT_OPENS_AT,
        closesAt: DEFAULT_CLOSES_AT,
        closed: weekday === 0,
      })),
    });

    // status "trialing" — sem cobrança implementada ainda (schema pronto
    // pra Stripe, ver campos stripeCustomerId/stripeSubscriptionId, mas
    // sem checkout/webhook por decisão consciente desta rodada).
    await tx.subscription.create({
      data: { barbershopId: barbershop.id, status: "trialing", plan: "starter", trialEndsAt },
    });

    const user = await tx.user.create({
      data: {
        barbershopId: barbershop.id,
        role: "owner",
        username: input.username,
        passwordHash: hashPassword(input.password),
        name: input.ownerName,
        email: input.email,
        emailVerificationToken: verificationToken,
        emailVerificationExpiresAt: verificationExpiresAt,
      },
    });

    return { barbershop, user };
  });

  // Fora da transação: se o envio falhar, a conta já foi criada com
  // sucesso — a pessoa pode pedir reenvio depois logada (não faz sentido
  // desfazer o cadastro inteiro por causa de uma falha no provedor de e-mail).
  const verifyUrl = `${env.PUBLIC_BASE_URL || ""}/api/verify-email?token=${verificationToken}`;
  try {
    await sendVerificationEmail(input.email, input.ownerName, verifyUrl);
  } catch (err) {
    console.error("[EMAIL] Falha ao enviar confirmação de cadastro:", err);
  }

  return { barbershop, user };
}
