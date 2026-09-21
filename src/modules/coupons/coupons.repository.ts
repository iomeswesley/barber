import { prisma } from "@/lib/prisma.js";
import { localDateStr } from "@/lib/time.js";
import { dateOnly } from "@/lib/time.js";

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
      validFrom: data.validFrom ? dateOnly(data.validFrom) : null,
      validTo: data.validTo ? dateOnly(data.validTo) : null,
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
  // "Hoje" no fuso do servidor (TZ), não em UTC — toISOString() já virava o dia
  // seguinte às 21h em Brasília e expirava cupom "válido até hoje" cedo demais.
  const today = localDateStr(new Date());
  if (coupon.validFrom && today < coupon.validFrom.toISOString().slice(0, 10)) return { valid: false, reason: "Cupom ainda não começou a valer" };
  if (coupon.validTo && today > coupon.validTo.toISOString().slice(0, 10)) return { valid: false, reason: "Cupom expirado" };
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) return { valid: false, reason: "Cupom esgotado" };
  return { valid: true };
}
