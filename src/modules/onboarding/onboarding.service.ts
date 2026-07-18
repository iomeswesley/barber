import { prisma } from "@/lib/prisma.js";
import { hashPassword } from "@/lib/auth.js";
import { AppError } from "@/middleware/errorHandler.js";

const TRIAL_DAYS = 14;
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
}

export async function signupBarbershop(input: SignupInput) {
  const existing = await prisma.user.findUnique({ where: { username: input.username } });
  if (existing) throw new AppError("Esse nome de usuário já está em uso.", 409);

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

  return prisma.$transaction(async (tx) => {
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
      },
    });

    return { barbershop, user };
  });
}
