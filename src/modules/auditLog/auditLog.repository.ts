import { prisma } from "@/lib/prisma.js";

export function logAudit(businessId: number, userName: string, action: string, details?: string | null) {
  return prisma.auditLog.create({
    data: { businessId, userName, action, details: details ?? null },
  });
}

export function listAuditLog(businessId: number, limit = 100) {
  return prisma.auditLog.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
