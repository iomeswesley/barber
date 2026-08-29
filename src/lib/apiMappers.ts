// O frontend (public/*.html) foi copiado sem alterações do barbearia-bot original
// e espera exatamente os nomes de campo em snake_case que o SQLite retornava
// (colunas de tabela puras + alguns aliases de JOIN). O backend internamente usa
// objetos do Prisma/DTOs em camelCase — essas funções fazem a conversão só na
// borda das rotas, sem mudar nenhuma lógica de negócio interna.
//
// Não é uma conversão genérica camelCase→snake_case: o app original já misturava
// convenções (campos calculados à mão como "occupancyPercent" ou "lowStock"
// ficaram em camelCase mesmo vindo de uma rota que devolve linhas em snake_case),
// então cada mapeador espelha o shape exato observado no server.js/db.js originais.

import type { AppointmentDTO } from "@/modules/appointments/appointments.types.js";
import type { Professional, Service, Product, TimeBlock, Escalation, AuditLog, BusinessHours, Business, ClientPlan, ProfessionalPayout, Expense, Coupon, Supplier, StockMovement, WaitlistEntry, FinancialAccount, CashSession } from "@prisma/client";
import type { ClientStatsRow } from "@/modules/dashboard/clientStats.service.js";
import { localDateStr } from "@/lib/time.js";

// Usado só na rota pública /api/barbershops (tela de reserva sem login) —
// omite whatsapp_phone_number_id e created_at, que não têm por que sair pra
// quem não está autenticado.
export function toApiBarbershopPublic(b: Business) {
  return {
    id: b.id,
    name: b.name,
    address: b.address,
    phone: b.phone,
  };
}

export function toApiAppointment(a: AppointmentDTO & { computedStatus?: string }) {
  return {
    id: a.id,
    barbershop_id: a.businessId,
    barber_id: a.professionalId,
    service_id: a.serviceId,
    client_id: a.clientId,
    date: a.date,
    start_time: a.startTime,
    end_time: a.endTime,
    status: a.status,
    reminder_sent_at: a.reminderSentAt,
    review_prompted_at: a.reviewPromptedAt,
    created_at: a.createdAt,
    barber_name: a.barberName,
    service_name: a.serviceName,
    duration_min: a.durationMin,
    price_cents: a.priceCents,
    client_name: a.clientName,
    client_phone: a.clientPhone,
    barbershop_name: a.barbershopName,
    notes: a.notes,
    payment_method: a.paymentMethod,
    coupon_id: a.couponId,
    ...(a.computedStatus !== undefined ? { computed_status: a.computedStatus } : {}),
  };
}

export function toApiBarber(b: Professional) {
  return {
    id: b.id,
    barbershop_id: b.businessId,
    name: b.name,
    active: b.active,
    service_commission_percent: Number(b.serviceCommissionPercent),
    product_commission_percent: Number(b.productCommissionPercent),
    monthly_goal_cents: b.monthlyGoalCents,
  };
}

export function toApiService(s: Service) {
  return {
    id: s.id,
    barbershop_id: s.businessId,
    name: s.name,
    price_cents: s.priceCents,
    duration_min: s.durationMin,
    active: s.active,
  };
}

export function toApiClientPlan(p: ClientPlan) {
  return {
    id: p.id,
    barbershop_id: p.businessId,
    name: p.name,
    price_cents: p.priceCents,
    benefit_type: p.benefitType,
    benefit_value: p.benefitValue,
    service_id: p.serviceId,
    active: p.active,
  };
}

export function toApiProduct(p: Product & { supplier?: { name: string } | null }) {
  return {
    id: p.id,
    barbershop_id: p.businessId,
    name: p.name,
    price_cents: p.priceCents,
    active: p.active,
    stock_quantity: p.stockQuantity,
    low_stock_threshold: p.lowStockThreshold,
    supplier_id: p.supplierId,
    supplier_name: p.supplier?.name ?? null,
  };
}

// periodStart/periodEnd são colunas @db.Date (meia-noite UTC) — precisam do
// mesmo dateToStr (ISO, sem conversão de fuso) que appointments.types.ts usa
// pro mesmo tipo de coluna. localDateStr é pra Date "agora" (hora local);
// usá-lo aqui deslocaria a data um dia pra trás em fuso negativo (Brasil).
function dbDateToStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function toApiPayout(p: ProfessionalPayout & { professional: { name: string } }) {
  const totalCents = p.serviceCommissionCents + p.productCommissionCents + p.adjustmentCents;
  return {
    id: p.id,
    barbershop_id: p.businessId,
    professional_id: p.professionalId,
    professional_name: p.professional.name,
    period_start: dbDateToStr(p.periodStart),
    period_end: dbDateToStr(p.periodEnd),
    service_commission_cents: p.serviceCommissionCents,
    product_commission_cents: p.productCommissionCents,
    adjustment_cents: p.adjustmentCents,
    adjustment_reason: p.adjustmentReason,
    total_cents: totalCents,
    status: p.status,
    paid_at: p.paidAt,
    note: p.note,
    created_by: p.createdBy,
    created_at: p.createdAt,
  };
}

export function toApiExpense(e: Expense) {
  return {
    id: e.id,
    barbershop_id: e.businessId,
    description: e.description,
    amount_cents: e.amountCents,
    due_date: dbDateToStr(e.dueDate),
    status: e.status,
    paid_at: e.paidAt,
    category: e.category,
    created_at: e.createdAt,
  };
}

export function toApiCoupon(c: Coupon) {
  return {
    id: c.id,
    barbershop_id: c.businessId,
    code: c.code,
    discount_type: c.discountType,
    discount_value: c.discountValue,
    valid_from: c.validFrom ? dbDateToStr(c.validFrom) : null,
    valid_to: c.validTo ? dbDateToStr(c.validTo) : null,
    usage_limit: c.usageLimit,
    used_count: c.usedCount,
    active: c.active,
    created_at: c.createdAt,
  };
}

export function toApiSupplier(s: Supplier) {
  return {
    id: s.id,
    barbershop_id: s.businessId,
    name: s.name,
    phone: s.phone,
    document: s.document,
    active: s.active,
    created_at: s.createdAt,
  };
}

export function toApiStockMovement(m: StockMovement & { productName?: string }) {
  return {
    id: m.id,
    barbershop_id: m.businessId,
    product_id: m.productId,
    product_name: m.productName,
    type: m.type,
    quantity: m.quantity,
    reason: m.reason,
    created_by: m.createdBy,
    created_at: m.createdAt,
  };
}

export function toApiWaitlistEntry(w: WaitlistEntry & { clientName?: string; clientPhone?: string; professionalName?: string | null; serviceName?: string | null }) {
  return {
    id: w.id,
    barbershop_id: w.businessId,
    client_id: w.clientId,
    client_name: w.clientName,
    client_phone: w.clientPhone,
    professional_id: w.professionalId,
    professional_name: w.professionalName,
    service_id: w.serviceId,
    service_name: w.serviceName,
    desired_date_start: dbDateToStr(w.desiredDateStart),
    desired_date_end: dbDateToStr(w.desiredDateEnd),
    status: w.status,
    notified_at: w.notifiedAt,
    created_at: w.createdAt,
  };
}

export function toApiFinancialAccount(a: FinancialAccount) {
  return {
    id: a.id,
    barbershop_id: a.businessId,
    name: a.name,
    type: a.type,
    active: a.active,
    created_at: a.createdAt,
  };
}

export function toApiCashSession(s: CashSession & { financialAccount?: { name: string; type: string } }) {
  return {
    id: s.id,
    barbershop_id: s.businessId,
    financial_account_id: s.financialAccountId,
    financial_account_name: s.financialAccount?.name,
    opened_at: s.openedAt,
    closed_at: s.closedAt,
    opening_balance_cents: s.openingBalanceCents,
    closing_balance_cents: s.closingBalanceCents,
    expected_closing_cents: s.expectedClosingCents,
    difference_cents: s.closingBalanceCents != null && s.expectedClosingCents != null ? s.closingBalanceCents - s.expectedClosingCents : null,
    opened_by: s.openedBy,
    closed_by: s.closedBy,
    note: s.note,
  };
}

export function toApiStockOverviewItem(p: Product & { lowStock: boolean }) {
  return { ...toApiProduct(p), lowStock: p.lowStock };
}

export function toApiProductSale(s: { id: number; businessId: number; clientId: number; productId: number; quantity: number; date: Date; appointmentId: number | null; createdAt: Date; productName: string; priceCents: number }) {
  return {
    id: s.id,
    barbershop_id: s.businessId,
    client_id: s.clientId,
    product_id: s.productId,
    quantity: s.quantity,
    date: s.date,
    appointment_id: s.appointmentId,
    created_at: s.createdAt,
    product_name: s.productName,
    price_cents: s.priceCents,
  };
}

export function toApiTimeBlock(tb: TimeBlock & { professional?: { name: string } | null }) {
  return {
    id: tb.id,
    barbershop_id: tb.businessId,
    barber_id: tb.professionalId,
    type: tb.type,
    label: tb.label,
    date: tb.date,
    start_time: tb.startTime,
    end_time: tb.endTime,
    recurring: tb.recurring,
    created_at: tb.createdAt,
    barber_name: tb.professional?.name ?? null,
  };
}

export function toApiEscalation(e: Escalation & { client?: { name: string } | null }) {
  return {
    id: e.id,
    barbershop_id: e.businessId,
    client_id: e.clientId,
    client_phone: e.clientPhone,
    reason: e.reason,
    resolved: e.resolved,
    created_at: e.createdAt,
    client_name: e.client?.name ?? null,
  };
}

export function toApiAuditLog(a: AuditLog) {
  return {
    id: a.id,
    barbershop_id: a.businessId,
    user_name: a.userName,
    action: a.action,
    details: a.details,
    created_at: a.createdAt,
  };
}

export function toApiBusinessHours(h: BusinessHours) {
  return {
    id: h.id,
    barbershop_id: h.businessId,
    weekday: h.weekday,
    opens_at: h.opensAt,
    closes_at: h.closesAt,
    closed: h.closed,
  };
}

export function toApiReview(r: {
  id: number;
  appointmentId: number;
  businessId: number;
  professionalId: number;
  clientId: number;
  rating: number;
  comment: string | null;
  createdAt: Date;
  client: { name: string };
  professional: { name: string };
  appointment: { service: { name: string } };
}) {
  return {
    id: r.id,
    appointment_id: r.appointmentId,
    barbershop_id: r.businessId,
    barber_id: r.professionalId,
    client_id: r.clientId,
    rating: r.rating,
    comment: r.comment,
    created_at: r.createdAt,
    client_name: r.client.name,
    barber_name: r.professional.name,
    service_name: r.appointment.service.name,
  };
}

export function toApiClientStats(c: ClientStatsRow) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    birthday: c.birthday,
    visit_count: c.visitCount,
    total_revenue_cents: c.totalRevenueCents,
    last_visit_date: c.lastVisitDate,
    avgFrequencyDays: c.avgFrequencyDays,
    dueStatus: c.dueStatus,
  };
}

export function toApiClientVisit(a: {
  id: number;
  date: Date;
  startTime: string;
  status: string;
  notes: string | null;
  service: { name: string; priceCents: number };
  professional: { name: string };
  productSales: { quantity: number; product: { name: string; priceCents: number } }[];
}) {
  return {
    id: a.id,
    date: localDateStr(a.date),
    start_time: a.startTime,
    status: a.status,
    notes: a.notes,
    service_name: a.service.name,
    barber_name: a.professional.name,
    price_cents: a.service.priceCents,
    products: a.productSales.map((ps) => ({
      name: ps.product.name,
      quantity: ps.quantity,
      price_cents: ps.product.priceCents,
    })),
  };
}
