import { prisma } from "@/lib/prisma.js";

export async function createReview({ appointmentId, rating, comment }: { appointmentId: number; rating: number; comment?: string | null }) {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment) throw new Error("Agendamento não encontrado.");
  return prisma.review.create({
    data: {
      appointmentId,
      businessId: appointment.businessId,
      professionalId: appointment.professionalId,
      clientId: appointment.clientId,
      rating,
      comment: comment || null,
    },
  });
}

function reviewPeriodCutoff(period?: string): Date | null {
  if (period === "week") {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d;
  }
  if (period === "month") {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  }
  return null;
}

export function listReviews(businessId: number, limit = 20, { period, professionalId }: { period?: string; professionalId?: number } = {}) {
  const cutoff = reviewPeriodCutoff(period);
  return prisma.review.findMany({
    where: {
      businessId,
      ...(cutoff ? { createdAt: { gte: cutoff } } : {}),
      ...(professionalId ? { professionalId } : {}),
    },
    include: {
      client: { select: { name: true } },
      professional: { select: { name: true } },
      appointment: { include: { service: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getReviewStats(businessId: number, { period, professionalId }: { period?: string; professionalId?: number } = {}) {
  const cutoff = reviewPeriodCutoff(period);
  const result = await prisma.review.aggregate({
    where: {
      businessId,
      ...(cutoff ? { createdAt: { gte: cutoff } } : {}),
      ...(professionalId ? { professionalId } : {}),
    },
    _count: { _all: true },
    _avg: { rating: true },
  });
  return {
    count: result._count._all,
    avgRating: result._avg.rating ? Math.round(result._avg.rating * 10) / 10 : null,
  };
}
