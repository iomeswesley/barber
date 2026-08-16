import { prisma } from "@/lib/prisma.js";

export function getBarbers(businessId: number, { includeInactive = false } = {}) {
  return prisma.professional.findMany({
    where: { businessId, ...(includeInactive ? {} : { active: true }) },
    orderBy: { id: "asc" },
  });
}

export function getBarber(id: number) {
  return prisma.professional.findUnique({ where: { id } });
}

// Igual getBarbers, mas trazendo junto o username do User de acesso (quando
// existir) — só usado na listagem da aba de gerenciamento (dono), pra
// preencher o formulário de editar sem expor isso na listagem pública de
// barbeiros (barbershops.routes.ts usa getBarbers puro, sem essa parte).
export function getBarbersWithUsername(businessId: number, { includeInactive = false } = {}) {
  return prisma.professional.findMany({
    where: { businessId, ...(includeInactive ? {} : { active: true }) },
    orderBy: { id: "asc" },
    include: { users: { select: { username: true, role: true }, take: 1 } },
  });
}

// `credentials` opcional: quando informado, cria também o User de acesso do
// barbeiro (role "professional", vinculado via professionalId) na mesma transação — sem
// isso o barbeiro ficaria cadastrado mas sem conseguir logar no painel dele.
export function createBarber(
  businessId: number,
  name: string,
  credentials?: { username: string; passwordHash: string },
  {
    serviceCommissionPercent,
    productCommissionPercent,
    monthlyGoalCents,
  }: { serviceCommissionPercent?: number; productCommissionPercent?: number; monthlyGoalCents?: number } = {}
) {
  const barberData = {
    businessId,
    name,
    ...(serviceCommissionPercent !== undefined ? { serviceCommissionPercent } : {}),
    ...(productCommissionPercent !== undefined ? { productCommissionPercent } : {}),
    ...(monthlyGoalCents !== undefined ? { monthlyGoalCents } : {}),
  };
  if (!credentials) {
    return prisma.professional.create({ data: barberData });
  }
  return prisma.$transaction(async (tx) => {
    const barber = await tx.professional.create({ data: barberData });
    await tx.user.create({
      data: {
        businessId,
        professionalId: barber.id,
        role: "professional",
        username: credentials.username,
        passwordHash: credentials.passwordHash,
        name,
      },
    });
    return barber;
  });
}

export function getBarberUser(professionalId: number) {
  return prisma.user.findFirst({ where: { professionalId } });
}

// Dono que também é barbeiro (bem comum): em vez de criar um segundo login
// (role "professional") só pra aparecer nos agendamentos/comissão, vincula o
// próprio barbeiro criado ao User de dono já existente — um login só,
// continua com acesso total ao painel, e passa a contar como barbeiro
// normal em toda a parte de agenda/faturamento/comissão.
export function linkBarberToOwner(businessId: number, professionalId: number) {
  return prisma.user.updateMany({ where: { businessId, role: "owner" }, data: { professionalId } });
}

export function createBarberUser(
  businessId: number,
  professionalId: number,
  name: string,
  username: string,
  passwordHash: string
) {
  return prisma.user.create({ data: { businessId, professionalId, role: "professional", username, passwordHash, name } });
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
  return prisma.professional.update({
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
  return prisma.professional.update({ where: { id }, data: { active } });
}

// Google Agenda (Fase 8) — tokens já vêm criptografados de quem chama
// (ver googleCalendar.routes.ts, usa encryptSecret/decryptSecret de lib/crypto.ts).
export function saveGoogleCalendarConnection(
  professionalId: number,
  data: { tokenEnc: string; refreshTokenEnc: string | null; calendarId: string }
) {
  return prisma.professional.update({
    where: { id: professionalId },
    data: {
      googleCalendarTokenEnc: data.tokenEnc,
      googleCalendarRefreshTokenEnc: data.refreshTokenEnc,
      googleCalendarId: data.calendarId,
      googleCalendarConnectedAt: new Date(),
    },
  });
}

export function clearGoogleCalendarConnection(professionalId: number) {
  return prisma.professional.update({
    where: { id: professionalId },
    data: {
      googleCalendarTokenEnc: null,
      googleCalendarRefreshTokenEnc: null,
      googleCalendarId: null,
      googleCalendarConnectedAt: null,
    },
  });
}

export function updateGoogleCalendarAccessToken(professionalId: number, tokenEnc: string) {
  return prisma.professional.update({ where: { id: professionalId }, data: { googleCalendarTokenEnc: tokenEnc } });
}
