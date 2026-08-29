import { prisma } from "@/lib/prisma.js";

export function getCoupons(businessId: number, { includeInactive = false } = {}) {
  return prisma.coupon.findMany({
    where: { businessId, ...(includeInactive ? {} : { active: true }) },
    orderBy: { id: "desc" },
  });
}

export function getCoupon(id: number) {
  return prisma.coupon.findUnique({ where: { id } });
}

export function getCouponByCode(businessId: number, code: string) {
  return prisma.coupon.findUnique({ where: { businessId_code: { businessId, code } } });
}

export function createCoupon(
  businessId: number,
  data: {
    code: string;
    discountType: "percent" | "fixed";
    discountValue: number;
    validFrom?: string | null;
    validTo?: string | null;
    usageLimit?: number | null;
  }
) {
  return prisma.coupon.create({
    data: {
      businessId,
      code: data.code.toUpperCase(),
      discountType: data.discountType,
      discountValue: data.discountValue,
      validFrom: data.validFrom ? new Date(`${data.validFrom}T00:00:00`) : null,
      validTo: data.validTo ? new Date(`${data.validTo}T00:00:00`) : null,
      usageLimit: data.usageLimit ?? null,
    },
  });
}

export function setCouponActive(id: number, active: boolean) {
  return prisma.coupon.update({ where: { id }, data: { active } });
}

export function incrementCouponUsage(id: number) {
  return prisma.coupon.update({ where: { id }, data: { usedCount: { increment: 1 } } });
}

// Validação central — usada tanto pela rota de aplicar cupom (painel) quanto
// por qualquer chamador futuro. Não mexe em usedCount (isso só acontece de
// fato quando o desconto é aplicado a um agendamento, ver
// appointments.service.ts) — aqui só diz se o código está "utilizável agora".
export function couponIsValidNow(coupon: {
  active: boolean;
  validFrom: Date | null;
  validTo: Date | null;
  usageLimit: number | null;
  usedCount: number;
}): { valid: boolean; reason?: string } {
  if (!coupon.active) return { valid: false, reason: "Cupom inativo" };
  const today = new Date().toISOString().slice(0, 10);
  if (coupon.validFrom && today < coupon.validFrom.toISOString().slice(0, 10)) return { valid: false, reason: "Cupom ainda não começou a valer" };
  if (coupon.validTo && today > coupon.validTo.toISOString().slice(0, 10)) return { valid: false, reason: "Cupom expirado" };
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) return { valid: false, reason: "Cupom esgotado" };
  return { valid: true };
}
