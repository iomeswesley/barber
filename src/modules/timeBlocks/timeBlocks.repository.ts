import { prisma } from "@/lib/prisma.js";
import { timeToMinutes } from "@/lib/time.js";

export interface TimeBlockInput {
  professionalId?: number | null;
  type: string;
  label?: string | null;
  date?: string | null;
  startTime: string;
  endTime: string;
  recurring: boolean;
}

export function createTimeBlock(businessId: number, input: TimeBlockInput) {
  return prisma.timeBlock.create({
    data: {
      businessId,
      professionalId: input.professionalId || null,
      type: input.type,
      label: input.label || null,
      date: input.recurring ? null : input.date ? new Date(input.date) : null,
      startTime: input.startTime,
      endTime: input.endTime,
      recurring: !!input.recurring,
    },
  });
}

export function listTimeBlocks(businessId: number) {
  return prisma.timeBlock.findMany({
    where: { businessId },
    include: { professional: { select: { name: true } } },
    orderBy: [{ recurring: "desc" }, { date: "asc" }, { startTime: "asc" }],
  });
}

export function listTimeBlocksForBarber(businessId: number, professionalId: number) {
  return prisma.timeBlock.findMany({
    where: { businessId, professionalId },
    include: { professional: { select: { name: true } } },
    orderBy: [{ recurring: "desc" }, { date: "asc" }, { startTime: "asc" }],
  });
}

export function getTimeBlockById(id: number) {
  return prisma.timeBlock.findUnique({ where: { id } });
}

export function updateTimeBlock(id: number, input: TimeBlockInput) {
  return prisma.timeBlock.update({
    where: { id },
    data: {
      professionalId: input.professionalId || null,
      type: input.type,
      label: input.label || null,
      date: input.recurring ? null : input.date ? new Date(input.date) : null,
      startTime: input.startTime,
      endTime: input.endTime,
      recurring: !!input.recurring,
    },
  });
}

export function deleteTimeBlock(id: number) {
  return prisma.timeBlock.delete({ where: { id } });
}

// Aplica-se a este barbeiro especificamente, OU à barbearia toda (professionalId nulo).
// Ou casa uma data fixa, ou é um bloqueio recorrente diário.
export async function getBlocksFor(businessId: number, professionalId: number, date: string) {
  const dateObj = new Date(`${date}T00:00:00`);
  const blocks = await prisma.timeBlock.findMany({
    where: {
      businessId,
      OR: [{ professionalId: null }, { professionalId }],
      AND: [{ OR: [{ recurring: true }, { date: dateObj }] }],
    },
  });
  return blocks.map((b) => ({ start: timeToMinutes(b.startTime), end: timeToMinutes(b.endTime) }));
}
