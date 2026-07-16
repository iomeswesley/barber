import { prisma } from "@/lib/prisma.js";

export function getServices(barbershopId: number, { includeInactive = false } = {}) {
  return prisma.service.findMany({
    where: { barbershopId, ...(includeInactive ? {} : { active: true }) },
    orderBy: { id: "asc" },
  });
}

export function getService(id: number) {
  return prisma.service.findUnique({ where: { id } });
}

export function createService(
  barbershopId: number,
  { name, priceCents, durationMin }: { name: string; priceCents: number; durationMin: number }
) {
  return prisma.service.create({ data: { barbershopId, name, priceCents, durationMin } });
}

export function updateService(
  id: number,
  { name, priceCents, durationMin }: { name: string; priceCents: number; durationMin: number }
) {
  return prisma.service.update({ where: { id }, data: { name, priceCents, durationMin } });
}

export function setServiceActive(id: number, active: boolean) {
  return prisma.service.update({ where: { id }, data: { active } });
}
