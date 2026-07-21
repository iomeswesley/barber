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

// Igual getBarbers, mas trazendo junto o username do User de acesso (quando
// existir) — só usado na listagem da aba de gerenciamento (dono), pra
// preencher o formulário de editar sem expor isso na listagem pública de
// barbeiros (barbershops.routes.ts usa getBarbers puro, sem essa parte).
export function getBarbersWithUsername(barbershopId: number, { includeInactive = false } = {}) {
  return prisma.barber.findMany({
    where: { barbershopId, ...(includeInactive ? {} : { active: true }) },
    orderBy: { id: "asc" },
    include: { users: { select: { username: true, role: true }, take: 1 } },
  });
}

// `credentials` opcional: quando informado, cria também o User de acesso do
// barbeiro (role "barber", vinculado via barberId) na mesma transação — sem
// isso o barbeiro ficaria cadastrado mas sem conseguir logar no painel dele.
export function createBarber(
  barbershopId: number,
  name: string,
  credentials?: { username: string; passwordHash: string },
  {
    serviceCommissionPercent,
    productCommissionPercent,
    monthlyGoalCents,
  }: { serviceCommissionPercent?: number; productCommissionPercent?: number; monthlyGoalCents?: number } = {}
) {
  const barberData = {
    barbershopId,
    name,
    ...(serviceCommissionPercent !== undefined ? { serviceCommissionPercent } : {}),
    ...(productCommissionPercent !== undefined ? { productCommissionPercent } : {}),
    ...(monthlyGoalCents !== undefined ? { monthlyGoalCents } : {}),
  };
  if (!credentials) {
    return prisma.barber.create({ data: barberData });
  }
  return prisma.$transaction(async (tx) => {
    const barber = await tx.barber.create({ data: barberData });
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

export function getBarberUser(barberId: number) {
  return prisma.user.findFirst({ where: { barberId } });
}

// Dono que também é barbeiro (bem comum): em vez de criar um segundo login
// (role "barber") só pra aparecer nos agendamentos/comissão, vincula o
// próprio barbeiro criado ao User de dono já existente — um login só,
// continua com acesso total ao painel, e passa a contar como barbeiro
// normal em toda a parte de agenda/faturamento/comissão.
export function linkBarberToOwner(barbershopId: number, barberId: number) {
  return prisma.user.updateMany({ where: { barbershopId, role: "owner" }, data: { barberId } });
}

export function createBarberUser(
  barbershopId: number,
  barberId: number,
  name: string,
  username: string,
  passwordHash: string
) {
  return prisma.user.create({ data: { barbershopId, barberId, role: "barber", username, passwordHash, name } });
}

export function updateBarberUser(userId: number, data: { username?: string; passwordHash?: string; name?: string }) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.username !== undefined ? { username: data.username } : {}),
      ...(data.passwordHash !== undefined ? { passwordHash: data.passwordHash } : {}),
      ...(data.name !== undefined ? { name: data.name } : {}),
    },
  });
}

export function updateBarber(
  id: number,
  name: string,
  {
    serviceCommissionPercent,
    productCommissionPercent,
    monthlyGoalCents,
  }: { serviceCommissionPercent?: number; productCommissionPercent?: number; monthlyGoalCents?: number } = {}
) {
  return prisma.barber.update({
    where: { id },
    data: {
      name,
      ...(serviceCommissionPercent !== undefined ? { serviceCommissionPercent } : {}),
      ...(productCommissionPercent !== undefined ? { productCommissionPercent } : {}),
      ...(monthlyGoalCents !== undefined ? { monthlyGoalCents } : {}),
    },
  });
}

export function setBarberActive(id: number, active: boolean) {
  return prisma.barber.update({ where: { id }, data: { active } });
}
