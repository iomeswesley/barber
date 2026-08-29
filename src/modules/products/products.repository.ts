import { prisma } from "@/lib/prisma.js";

export function getProducts(businessId: number, { includeInactive = false } = {}) {
  return prisma.product.findMany({
    where: { businessId, ...(includeInactive ? {} : { active: true }) },
    orderBy: { id: "asc" },
    include: { supplier: { select: { name: true } } },
  });
}

export function getProduct(id: number) {
  return prisma.product.findUnique({ where: { id } });
}

// Grava uma linha de histórico pra toda mudança de stockQuantity — ver
// comentário do model StockMovement no schema. createdBy default "sistema"
// cobre chamadores internos que não têm sessão de usuário (nenhum hoje, mas
// evita quebrar se algum job futuro mexer em estoque direto).
export function logStockMovement(
  businessId: number,
  productId: number,
  type: "entrada" | "saida" | "ajuste",
  quantity: number,
  reason: string | null,
  createdBy = "sistema"
) {
  if (quantity <= 0) return Promise.resolve(null);
  return prisma.stockMovement.create({ data: { businessId, productId, type, quantity, reason, createdBy } });
}

export async function createProduct(
  businessId: number,
  {
    name,
    priceCents,
    stockQuantity,
    lowStockThreshold,
    supplierId,
  }: { name: string; priceCents: number; stockQuantity?: number; lowStockThreshold?: number; supplierId?: number | null },
  createdBy = "sistema"
) {
  const product = await prisma.product.create({
    data: {
      businessId,
      name,
      priceCents,
      stockQuantity: stockQuantity || 0,
      lowStockThreshold: lowStockThreshold ?? 5,
      supplierId: supplierId ?? null,
    },
  });
  if (product.stockQuantity > 0) {
    await logStockMovement(businessId, product.id, "entrada", product.stockQuantity, "Estoque inicial", createdBy);
  }
  return product;
}

export async function updateProduct(
  id: number,
  {
    name,
    priceCents,
    stockQuantity,
    lowStockThreshold,
    supplierId,
  }: { name: string; priceCents: number; stockQuantity?: number; lowStockThreshold?: number; supplierId?: number | null },
  createdBy = "sistema"
) {
  const current = await prisma.product.findUniqueOrThrow({ where: { id } });
  const newStock = stockQuantity !== undefined ? stockQuantity : current.stockQuantity;
  const updated = await prisma.product.update({
    where: { id },
    data: {
      name,
      priceCents,
      stockQuantity: newStock,
      lowStockThreshold: lowStockThreshold !== undefined ? lowStockThreshold : current.lowStockThreshold,
      supplierId: supplierId !== undefined ? supplierId : current.supplierId,
    },
  });
  // Ajuste manual do estoque atual (não venda) — só loga se o número
  // realmente mudou, senão toda edição de nome/preço geraria um movimento
  // fantasma de quantidade zero.
  const delta = newStock - current.stockQuantity;
  if (delta !== 0) {
    await logStockMovement(current.businessId, id, "ajuste", Math.abs(delta), delta > 0 ? "Ajuste manual (entrada)" : "Ajuste manual (saída)", createdBy);
  }
  return updated;
}

export function setProductActive(id: number, active: boolean) {
  return prisma.product.update({ where: { id }, data: { active } });
}

export function adjustProductStock(id: number, delta: number) {
  return prisma.product.update({ where: { id }, data: { stockQuantity: { increment: delta } } });
}

export async function getStockOverview(businessId: number) {
  const products = await getProducts(businessId, { includeInactive: true });
  return products.map((p) => ({ ...p, lowStock: p.active && p.stockQuantity <= p.lowStockThreshold }));
}

export async function createProductSale(
  businessId: number,
  {
    clientId,
    productId,
    quantity,
    date,
    appointmentId,
    paymentMethod,
  }: {
    clientId: number;
    productId: number;
    quantity?: number;
    date: string;
    appointmentId?: number | null;
    paymentMethod?: "dinheiro" | "pix" | "cartao" | "outro" | null;
  },
  createdBy = "sistema"
) {
  const qty = quantity || 1;
  const sale = await prisma.productSale.create({
    data: {
      businessId,
      clientId,
      productId,
      quantity: qty,
      date: new Date(`${date}T00:00:00`),
      appointmentId: appointmentId || null,
      paymentMethod: paymentMethod || null,
    },
    include: { product: { select: { name: true, priceCents: true } } },
  });
  await adjustProductStock(productId, -qty);
  await logStockMovement(businessId, productId, "saida", qty, "Venda", createdBy);
  return { ...sale, productName: sale.product.name, priceCents: sale.product.priceCents };
}

export async function getProductSalesForAppointment(appointmentId: number) {
  const sales = await prisma.productSale.findMany({
    where: { appointmentId },
    include: { product: { select: { name: true, priceCents: true } } },
    orderBy: { id: "asc" },
  });
  return sales.map((s) => ({ ...s, productName: s.product.name, priceCents: s.product.priceCents }));
}

// O formulário de edição de agendamento sempre envia a lista completa e atual de
// produtos vendidos naquela visita, então substituímos (em vez de acrescentar)
// o que foi registrado antes — senão re-salvar o mesmo agendamento sem mudanças
// duplicaria a venda. O estoque é restaurado antes de deduzir de novo, então
// editar um agendamento nunca drena silenciosamente estoque que nunca foi vendido.
// A restauração em si não gera StockMovement (é reversão de um reenvio de
// formulário, não um evento de negócio novo) — só a venda final registrada
// de novo via createProductSale entra no histórico.
export async function replaceAppointmentProductSales(
  businessId: number,
  clientId: number,
  appointmentId: number,
  date: string,
  sales: { productId: number; quantity: number }[],
  createdBy = "sistema",
  paymentMethod?: "dinheiro" | "pix" | "cartao" | "outro" | null
) {
  const old = await getProductSalesForAppointment(appointmentId);
  for (const o of old) {
    await adjustProductStock(o.productId, o.quantity);
  }
  await prisma.productSale.deleteMany({ where: { appointmentId } });
  for (const s of sales) {
    if (!s.productId) continue;
    await createProductSale(
      businessId,
      {
        clientId,
        productId: s.productId,
        quantity: s.quantity || 1,
        date,
        appointmentId,
        paymentMethod,
      },
      createdBy
    );
  }
  return getProductSalesForAppointment(appointmentId);
}

export async function getProductSalesRevenue(businessId: number, { dateFrom, dateTo }: { dateFrom?: string; dateTo?: string } = {}) {
  const sales = await prisma.productSale.findMany({
    where: {
      businessId,
      ...(dateFrom || dateTo
        ? {
            date: {
              ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00`) } : {}),
              ...(dateTo ? { lte: new Date(`${dateTo}T00:00:00`) } : {}),
            },
          }
        : {}),
    },
    include: { product: { select: { priceCents: true } } },
  });
  return sales.map((s) => ({
    date: s.date.toISOString().slice(0, 10),
    amountCents: s.quantity * s.product.priceCents,
  }));
}

// Igual getProductSalesRevenue, mas inclui o appointmentId — usado só pra
// atribuir venda de produto a um barbeiro (via o agendamento vinculado, ver
// getBarberPerformance). Venda avulsa sem agendamento (appointmentId nulo)
// não tem como ser atribuída a ninguém, então fica de fora dessa visão por
// barbeiro (mas continua contando no faturamento total da barbearia).
export async function getProductSalesWithAppointment(
  businessId: number,
  { dateFrom, dateTo }: { dateFrom?: string; dateTo?: string } = {}
) {
  const sales = await prisma.productSale.findMany({
    where: {
      businessId,
      appointmentId: { not: null },
      ...(dateFrom || dateTo
        ? {
            date: {
              ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00`) } : {}),
              ...(dateTo ? { lte: new Date(`${dateTo}T00:00:00`) } : {}),
            },
          }
        : {}),
    },
    include: { product: { select: { priceCents: true } } },
  });
  return sales.map((s) => ({
    appointmentId: s.appointmentId as number,
    amountCents: s.quantity * s.product.priceCents,
  }));
}

/* ---------------- Fornecedores ---------------- */

export function getSuppliers(businessId: number, { includeInactive = false } = {}) {
  return prisma.supplier.findMany({ where: { businessId, ...(includeInactive ? {} : { active: true }) }, orderBy: { name: "asc" } });
}

export function getSupplier(id: number) {
  return prisma.supplier.findUnique({ where: { id } });
}

export function createSupplier(businessId: number, data: { name: string; phone?: string | null; document?: string | null }) {
  return prisma.supplier.create({ data: { businessId, name: data.name, phone: data.phone || null, document: data.document || null } });
}

export function setSupplierActive(id: number, active: boolean) {
  return prisma.supplier.update({ where: { id }, data: { active } });
}

/* ---------------- Movimentação de estoque ---------------- */

export async function getStockMovements(businessId: number, { productId, limit = 50 }: { productId?: number; limit?: number } = {}) {
  const movements = await prisma.stockMovement.findMany({
    where: { businessId, ...(productId ? { productId } : {}) },
    include: { product: { select: { name: true } } },
    orderBy: { id: "desc" },
    take: limit,
  });
  return movements.map((m) => ({ ...m, productName: m.product.name }));
}
