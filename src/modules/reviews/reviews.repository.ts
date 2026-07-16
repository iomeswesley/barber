import { prisma } from "@/lib/prisma.js";

export async function createReview({ appointmentId, rating, comment }: { appointmentId: number; rating: number; comment?: string | null }) {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment) throw new Error("Agendamento não encontrado.");
  return prisma.review.create({
    data: {
      appointmentId,
      barbershopId: appointment.barbershopId,
      barberId: appointment.barberId,
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

export function listReviews(barbershopId: number, limit = 20, { period, barberId }: { period?: string; barberId?: number } = {}) {
  const cutoff = reviewPeriodCutoff(period);
  return prisma.review.findMany({
    where: {
      barbershopId,
      ...(cutoff ? { createdAt: { gte: cutoff } } : {}),
      ...(barberId ? { barberId } : {}),
    },
    include: {
      client: { select: { name: true } },
      barber: { select: { name: true } },
      appointment: { include: { service: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getReviewStats(barbershopId: number, { period, barberId }: { period?: string; barberId?: number } = {}) {
  const cutoff = reviewPeriodCutoff(period);
  const result = await prisma.review.aggregate({
    where: {
      barbershopId,
      ...(cutoff ? { createdAt: { gte: cutoff } } : {}),
      ...(barberId ? { barberId } : {}),
    },
    _count: { _all: true },
    _avg: { rating: true },
  });
  return {
    count: result._count._all,
    avgRating: result._avg.rating ? Math.round(result._avg.rating * 10) / 10 : null,
  };
}
