import { Router } from "express";
import { requireAuth, requireOwner, belongsToSession } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { toApiProduct, toApiStockOverviewItem, toApiSupplier, toApiStockMovement } from "@/lib/apiMappers.js";
import {
  getProduct,
  getProducts,
  getStockOverview,
  createProduct,
  updateProduct,
  setProductActive,
  getSuppliers,
  getSupplier,
  createSupplier,
  setSupplierActive,
  getStockMovements,
} from "./products.repository.js";

export const productsRouter = Router();

productsRouter.get("/api/manage/products", requireAuth, async (req, res) => {
  const products = await getProducts(req.session.user!.businessId, { includeInactive: true });
  res.json(products.map(toApiProduct));
});

productsRouter.get("/api/manage/stock-overview", requireAuth, requireOwner, async (req, res) => {
  const overview = await getStockOverview(req.session.user!.businessId);
  res.json(overview.map(toApiStockOverviewItem));
});

productsRouter.post("/api/manage/products", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { name, priceCents, stockQuantity, lowStockThreshold, supplierId } = req.body || {};
    if (!name || !String(name).trim() || !priceCents) {
      throw new AppError("name e priceCents são obrigatórios");
    }
    const businessId = req.session.user!.businessId;
    if (supplierId) {
      const supplier = await getSupplier(Number(supplierId));
      if (!belongsToSession(req, supplier)) throw new AppError("Fornecedor inválido");
    }
    const product = await createProduct(
      businessId,
      {
        name: String(name).trim(),
        priceCents: Number(priceCents),
        stockQuantity: Number(stockQuantity) || 0,
        lowStockThreshold: lowStockThreshold !== undefined ? Number(lowStockThreshold) : undefined,
        supplierId: supplierId ? Number(supplierId) : null,
      },
      req.session.user!.name
    );
    await logAudit(businessId, req.session.user!.name, "Criou produto", `${product.name} · estoque: ${product.stockQuantity}`);
    res.status(201).json(toApiProduct(product));
  } catch (err) {
    next(err);
  }
});

productsRouter.put("/api/manage/products/:id", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const product = await getProduct(Number(req.params.id));
    if (!belongsToSession(req, product)) throw new AppError("Produto não encontrado", 404);
    const { name, priceCents, stockQuantity, lowStockThreshold, supplierId } = req.body || {};
    if (!name || !String(name).trim() || !priceCents) {
      throw new AppError("name e priceCents são obrigatórios");
    }
    if (supplierId) {
      const supplier = await getSupplier(Number(supplierId));
      if (!belongsToSession(req, supplier)) throw new AppError("Fornecedor inválido");
    }
    const updated = await updateProduct(
      Number(req.params.id),
      {
        name: String(name).trim(),
        priceCents: Number(priceCents),
        stockQuantity: stockQuantity !== undefined ? Number(stockQuantity) : undefined,
        lowStockThreshold: lowStockThreshold !== undefined ? Number(lowStockThreshold) : undefined,
        supplierId: supplierId !== undefined ? (supplierId ? Number(supplierId) : null) : undefined,
      },
      req.session.user!.name
    );
    await logAudit(
      req.session.user!.businessId,
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

/* ---------------- Fornecedores ---------------- */

productsRouter.get("/api/manage/suppliers", requireAuth, async (req, res) => {
  const suppliers = await getSuppliers(req.session.user!.businessId, { includeInactive: true });
  res.json(suppliers.map(toApiSupplier));
});

productsRouter.post("/api/manage/suppliers", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { name, phone, document } = req.body || {};
    if (!name || !String(name).trim()) throw new AppError("name é obrigatório");
    const businessId = req.session.user!.businessId;
    const supplier = await createSupplier(businessId, { name: String(name).trim(), phone: phone || null, document: document || null });
    await logAudit(businessId, req.session.user!.name, "Criou fornecedor", supplier.name);
    res.status(201).json(toApiSupplier(supplier));
  } catch (err) {
    next(err);
  }
});

productsRouter.post("/api/manage/suppliers/:id/active", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const supplier = await getSupplier(Number(req.params.id));
    if (!belongsToSession(req, supplier)) throw new AppError("Fornecedor não encontrado", 404);
    const updated = await setSupplierActive(supplier!.id, !!req.body?.active);
    res.json(toApiSupplier(updated));
  } catch (err) {
    next(err);
  }
});

/* ---------------- Movimentação de estoque ---------------- */

productsRouter.get("/api/manage/stock-movements", requireAuth, requireOwner, async (req, res) => {
  const productId = req.query.productId ? Number(req.query.productId) : undefined;
  const movements = await getStockMovements(req.session.user!.businessId, { productId });
  res.json(movements.map(toApiStockMovement));
});
