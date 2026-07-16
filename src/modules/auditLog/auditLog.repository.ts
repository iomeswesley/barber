import { prisma } from "@/lib/prisma.js";

export function logAudit(barbershopId: number, userName: string, action: string, details?: string | null) {
  return prisma.auditLog.create({
    data: { barbershopId, userName, action, details: details ?? null },
  });
}

export function listAuditLog(barbershopId: number, limit = 100) {
  return prisma.auditLog.findMany({
    where: { barbershopId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
