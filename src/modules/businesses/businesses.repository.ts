import { prisma } from "@/lib/prisma.js";
import { weekdayForDateStr } from "@/lib/time.js";

export function getBarbershops() {
  return prisma.business.findMany({ orderBy: { id: "asc" } });
}

export function getBarbershop(id: number) {
  return prisma.business.findUnique({ where: { id } });
}

export function getBarbershopByWhatsappPhoneNumberId(phoneNumberId: string) {
  return prisma.business.findUnique({ where: { whatsappPhoneNumberId: phoneNumberId } });
}

export async function getToneExamples(businessId: number): Promise<string[]> {
  const shop = await prisma.business.findUnique({ where: { id: businessId }, select: { toneExamples: true } });
  return shop?.toneExamples ?? [];
}

export function updateToneExamples(businessId: number, examples: string[]) {
  return prisma.business.update({ where: { id: businessId }, data: { toneExamples: examples } });
}

export function getBusinessHours(businessId: number) {
  return prisma.businessHours.findMany({
    where: { businessId },
    orderBy: { weekday: "asc" },
  });
}

export function getBusinessHoursForWeekday(businessId: number, weekday: number) {
  return prisma.businessHours.findUnique({
    where: { businessId_weekday: { businessId, weekday } },
  });
}

export function getBusinessHoursForDate(businessId: number, dateStr: string) {
  return getBusinessHoursForWeekday(businessId, weekdayForDateStr(dateStr));
}

export interface BusinessHoursInput {
  weekday: number;
  opensAt: string;
  closesAt: string;
  closed: boolean;
}

export async function updateBusinessHours(businessId: number, hours: BusinessHoursInput[]) {
  await prisma.$transaction(
    hours.map((h) =>
      prisma.businessHours.upsert({
        where: { businessId_weekday: { businessId, weekday: h.weekday } },
        update: { opensAt: h.opensAt, closesAt: h.closesAt, closed: h.closed },
        create: {
          businessId,
          weekday: h.weekday,
          opensAt: h.opensAt,
          closesAt: h.closesAt,
          closed: h.closed,
        },
      })
    )
  );
  return getBusinessHours(businessId);
}
