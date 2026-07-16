import { Router } from "express";
import { requireAuth, requireOwner, belongsToSession } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { toApiProduct, toApiStockOverviewItem } from "@/lib/apiMappers.js";
import {
  getProduct,
  getProducts,
  getStockOverview,
  createProduct,
  updateProduct,
  setProductActive,
} from "./products.repository.js";

export const productsRouter = Router();

productsRouter.get("/api/manage/products", requireAuth, async (req, res) => {
  const products = await getProducts(req.session.user!.barbershopId, { includeInactive: true });
  res.json(products.map(toApiProduct));
});

productsRouter.get("/api/manage/stock-overview", requireAuth, requireOwner, async (req, res) => {
  const overview = await getStockOverview(req.session.user!.barbershopId);
  res.json(overview.map(toApiStockOverviewItem));
});

productsRouter.post("/api/manage/products", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { name, priceCents, stockQuantity, lowStockThreshold } = req.body || {};
    if (!name || !String(name).trim() || !priceCents) {
      throw new AppError("name e priceCents são obrigatórios");
    }
    const barbershopId = req.session.user!.barbershopId;
    const product = await createProduct(barbershopId, {
      name: String(name).trim(),
      priceCents: Number(priceCents),
      stockQuantity: Number(stockQuantity) || 0,
      lowStockThreshold: lowStockThreshold !== undefined ? Number(lowStockThreshold) : undefined,
    });
    await logAudit(barbershopId, req.session.user!.name, "Criou produto", `${product.name} · estoque: ${product.stockQuantity}`);
    res.status(201).json(toApiProduct(product));
  } catch (err) {
    next(err);
  }
});

productsRouter.put("/api/manage/products/:id", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const product = await getProduct(Number(req.params.id));
    if (!belongsToSession(req, product)) throw new AppError("Produto não encontrado", 404);
    const { name, priceCents, stockQuantity, lowStockThreshold } = req.body || {};
    if (!name || !String(name).trim() || !priceCents) {
      throw new AppError("name e priceCents são obrigatórios");
    }
    const updated = await updateProduct(Number(req.params.id), {
      name: String(name).trim(),
      priceCents: Number(priceCents),
      stockQuantity: stockQuantity !== undefined ? Number(stockQuantity) : undefined,
      lowStockThreshold: lowStockThreshold !== undefined ? Number(lowStockThreshold) : undefined,
    });
    await logAudit(
      req.session.user!.barbershopId,
      req.session.user!.name,
      "Editou produto",
      `${updated.name} · estoque: ${updated.stockQuantity}`
    );
    res.json(toApiProduct(updated));
  } catch (err) {
    next(err);
  }
});

productsRouter.post("/api/manage/products/:id/active", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const product = await getProduct(Number(req.params.id));
    if (!belongsToSession(req, product)) throw new AppError("Produto não encontrado", 404);
    const { active } = req.body || {};
    res.json(toApiProduct(await setProductActive(Number(req.params.id), !!active)));
  } catch (err) {
    next(err);
  }
});
