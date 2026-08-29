import { Router } from "express";
import { requireAuth, requireOwner, belongsToSession } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { toApiCoupon } from "@/lib/apiMappers.js";
import { getCoupons, getCoupon, createCoupon, setCouponActive } from "./coupons.repository.js";

export const couponsRouter = Router();

couponsRouter.get("/api/manage/coupons", requireAuth, requireOwner, async (req, res) => {
  const coupons = await getCoupons(req.session.user!.businessId, { includeInactive: true });
  res.json(coupons.map(toApiCoupon));
});

couponsRouter.post("/api/manage/coupons", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const businessId = req.session.user!.businessId;
    const { code, discountType, discountValue, validFrom, validTo, usageLimit } = req.body || {};
    if (!code || !String(code).trim()) throw new AppError("code é obrigatório");
    if (!["percent", "fixed"].includes(discountType)) throw new AppError("discountType deve ser percent ou fixed");
    if (!discountValue || Number(discountValue) <= 0) throw new AppError("discountValue deve ser maior que zero");
    if (discountType === "percent" && Number(discountValue) > 100) throw new AppError("Desconto percentual não pode passar de 100%");

    const coupon = await createCoupon(businessId, {
      code: String(code).trim(),
      discountType,
      discountValue: Number(discountValue),
      validFrom: validFrom || null,
      validTo: validTo || null,
      usageLimit: usageLimit ? Number(usageLimit) : null,
    }).catch((err) => {
      if (err?.code === "P2002") throw new AppError("Já existe um cupom com esse código");
      throw err;
    });
    await logAudit(businessId, req.session.user!.name, "Criou cupom", coupon.code);
    res.status(201).json(toApiCoupon(coupon));
  } catch (err) {
    next(err);
  }
});

couponsRouter.post("/api/manage/coupons/:id/active", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const coupon = await getCoupon(Number(req.params.id));
    if (!belongsToSession(req, coupon)) throw new AppError("Cupom não encontrado", 404);
    const updated = await setCouponActive(coupon!.id, !!req.body?.active);
    await logAudit(req.session.user!.businessId, req.session.user!.name, updated.active ? "Ativou cupom" : "Desativou cupom", updated.code);
    res.json(toApiCoupon(updated));
  } catch (err) {
    next(err);
  }
});
