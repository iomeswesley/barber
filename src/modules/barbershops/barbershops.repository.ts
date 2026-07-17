import { prisma } from "@/lib/prisma.js";
import { weekdayForDateStr } from "@/lib/time.js";

export function getBarbershops() {
  return prisma.barbershop.findMany({ orderBy: { id: "asc" } });
}

export function getBarbershop(id: number) {
  return prisma.barbershop.findUnique({ where: { id } });
}

export function getBarbershopByWhatsappPhoneNumberId(phoneNumberId: string) {
  return prisma.barbershop.findUnique({ where: { whatsappPhoneNumberId: phoneNumberId } });
}

export function getBusinessHours(barbershopId: number) {
  return prisma.businessHours.findMany({
    where: { barbershopId },
    orderBy: { weekday: "asc" },
  });
}

export function getBusinessHoursForWeekday(barbershopId: number, weekday: number) {
  return prisma.businessHours.findUnique({
    where: { barbershopId_weekday: { barbershopId, weekday } },
  });
}

export function getBusinessHoursForDate(barbershopId: number, dateStr: string) {
  return getBusinessHoursForWeekday(barbershopId, weekdayForDateStr(dateStr));
}

export interface BusinessHoursInput {
  weekday: number;
  opensAt: string;
  closesAt: string;
  closed: boolean;
}

export async function updateBusinessHours(barbershopId: number, hours: BusinessHoursInput[]) {
  await prisma.$transaction(
    hours.map((h) =>
      prisma.businessHours.upsert({
        where: { barbershopId_weekday: { barbershopId, weekday: h.weekday } },
        update: { opensAt: h.opensAt, closesAt: h.closesAt, closed: h.closed },
        create: {
          barbershopId,
          weekday: h.weekday,
          opensAt: h.opensAt,
          closesAt: h.closesAt,
          closed: h.closed,
        },
      })
    )
  );
  return getBusinessHours(barbershopId);
}
