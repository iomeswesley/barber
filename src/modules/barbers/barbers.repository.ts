import { prisma } from "@/lib/prisma.js";

export function getBarbers(barbershopId: number, { includeInactive = false } = {}) {
  return prisma.barber.findMany({
    where: { barbershopId, ...(includeInactive ? {} : { active: true }) },
    orderBy: { id: "asc" },
  });
}

export function getBarber(id: number) {
  return prisma.barber.findUnique({ where: { id } });
}

// `credentials` opcional: quando informado, cria também o User de acesso do
// barbeiro (role "barber", vinculado via barberId) na mesma transação — sem
// isso o barbeiro ficaria cadastrado mas sem conseguir logar no painel dele.
export function createBarber(
  barbershopId: number,
  name: string,
  credentials?: { username: string; passwordHash: string }
) {
  if (!credentials) {
    return prisma.barber.create({ data: { barbershopId, name } });
  }
  return prisma.$transaction(async (tx) => {
    const barber = await tx.barber.create({ data: { barbershopId, name } });
    await tx.user.create({
      data: {
        barbershopId,
        barberId: barber.id,
        role: "barber",
        username: credentials.username,
        passwordHash: credentials.passwordHash,
        name,
      },
    });
    return barber;
  });
}

export function updateBarber(
  id: number,
  name: string,
  { commissionPercent, monthlyGoalCents }: { commissionPercent?: number; monthlyGoalCents?: number } = {}
) {
  return prisma.barber.update({
    where: { id },
    data: {
      name,
      ...(commissionPercent !== undefined ? { commissionPercent } : {}),
      ...(monthlyGoalCents !== undefined ? { monthlyGoalCents } : {}),
    },
  });
}

export function setBarberActive(id: number, active: boolean) {
  return prisma.barber.update({ where: { id }, data: { active } });
}
