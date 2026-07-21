import { prisma } from "@/lib/prisma.js";

export function getProducts(barbershopId: number, { includeInactive = false } = {}) {
  return prisma.product.findMany({
    where: { barbershopId, ...(includeInactive ? {} : { active: true }) },
    orderBy: { id: "asc" },
  });
}

export function getProduct(id: number) {
  return prisma.product.findUnique({ where: { id } });
}

export function createProduct(
  barbershopId: number,
  { name, priceCents, stockQuantity, lowStockThreshold }: { name: string; priceCents: number; stockQuantity?: number; lowStockThreshold?: number }
) {
  return prisma.product.create({
    data: {
      barbershopId,
      name,
      priceCents,
      stockQuantity: stockQuantity || 0,
      lowStockThreshold: lowStockThreshold ?? 5,
    },
  });
}

export async function updateProduct(
  id: number,
  { name, priceCents, stockQuantity, lowStockThreshold }: { name: string; priceCents: number; stockQuantity?: number; lowStockThreshold?: number }
) {
  const current = await prisma.product.findUniqueOrThrow({ where: { id } });
  return prisma.product.update({
    where: { id },
    data: {
      name,
      priceCents,
      stockQuantity: stockQuantity !== undefined ? stockQuantity : current.stockQuantity,
      lowStockThreshold: lowStockThreshold !== undefined ? lowStockThreshold : current.lowStockThreshold,
    },
  });
}

export function setProductActive(id: number, active: boolean) {
  return prisma.product.update({ where: { id }, data: { active } });
}

export function adjustProductStock(id: number, delta: number) {
  return prisma.product.update({ where: { id }, data: { stockQuantity: { increment: delta } } });
}

export async function getStockOverview(barbershopId: number) {
  const products = await getProducts(barbershopId, { includeInactive: true });
  return products.map((p) => ({ ...p, lowStock: p.active && p.stockQuantity <= p.lowStockThreshold }));
}

export async function createProductSale(
  barbershopId: number,
  { clientId, productId, quantity, date, appointmentId }: { clientId: number; productId: number; quantity?: number; date: string; appointmentId?: number | null }
) {
  const qty = quantity || 1;
  const sale = await prisma.productSale.create({
    data: {
      barbershopId,
      clientId,
      productId,
      quantity: qty,
      date: new Date(`${date}T00:00:00`),
      appointmentId: appointmentId || null,
    },
    include: { product: { select: { name: true, priceCents: true } } },
  });
  await adjustProductStock(productId, -qty);
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
export async function replaceAppointmentProductSales(
  barbershopId: number,
  clientId: number,
  appointmentId: number,
  date: string,
  sales: { productId: number; quantity: number }[]
) {
  const old = await getProductSalesForAppointment(appointmentId);
  for (const o of old) {
    await adjustProductStock(o.productId, o.quantity);
  }
  await prisma.productSale.deleteMany({ where: { appointmentId } });
  for (const s of sales) {
    if (!s.productId) continue;
    await createProductSale(barbershopId, {
      clientId,
      productId: s.productId,
      quantity: s.quantity || 1,
      date,
      appointmentId,
    });
  }
  return getProductSalesForAppointment(appointmentId);
}

export async function getProductSalesRevenue(barbershopId: number, { dateFrom, dateTo }: { dateFrom?: string; dateTo?: string } = {}) {
  const sales = await prisma.productSale.findMany({
    where: {
      barbershopId,
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
  barbershopId: number,
  { dateFrom, dateTo }: { dateFrom?: string; dateTo?: string } = {}
) {
  const sales = await prisma.productSale.findMany({
    where: {
      barbershopId,
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
