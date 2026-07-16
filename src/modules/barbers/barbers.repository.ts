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

export function createBarber(barbershopId: number, name: string) {
  return prisma.barber.create({ data: { barbershopId, name } });
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
