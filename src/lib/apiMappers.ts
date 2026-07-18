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
import type { Barber, Service, Product, TimeBlock, Escalation, AuditLog, BusinessHours, Barbershop } from "@prisma/client";
import type { ClientStatsRow } from "@/modules/dashboard/clientStats.service.js";
import { localDateStr } from "@/lib/time.js";

// Usado só na rota pública /api/barbershops (tela de reserva sem login) —
// omite whatsapp_phone_number_id e created_at, que não têm por que sair pra
// quem não está autenticado.
export function toApiBarbershopPublic(b: Barbershop) {
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
    barbershop_id: a.barbershopId,
    barber_id: a.barberId,
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
    ...(a.computedStatus !== undefined ? { computed_status: a.computedStatus } : {}),
  };
}

export function toApiBarber(b: Barber) {
  return {
    id: b.id,
    barbershop_id: b.barbershopId,
    name: b.name,
    active: b.active,
    commission_percent: Number(b.commissionPercent),
    monthly_goal_cents: b.monthlyGoalCents,
  };
}

export function toApiService(s: Service) {
  return {
    id: s.id,
    barbershop_id: s.barbershopId,
    name: s.name,
    price_cents: s.priceCents,
    duration_min: s.durationMin,
    active: s.active,
  };
}

export function toApiProduct(p: Product) {
  return {
    id: p.id,
    barbershop_id: p.barbershopId,
    name: p.name,
    price_cents: p.priceCents,
    active: p.active,
    stock_quantity: p.stockQuantity,
    low_stock_threshold: p.lowStockThreshold,
  };
}

export function toApiStockOverviewItem(p: Product & { lowStock: boolean }) {
  return { ...toApiProduct(p), lowStock: p.lowStock };
}

export function toApiProductSale(s: { id: number; barbershopId: number; clientId: number; productId: number; quantity: number; date: Date; appointmentId: number | null; createdAt: Date; productName: string; priceCents: number }) {
  return {
    id: s.id,
    barbershop_id: s.barbershopId,
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

export function toApiTimeBlock(tb: TimeBlock & { barber?: { name: string } | null }) {
  return {
    id: tb.id,
    barbershop_id: tb.barbershopId,
    barber_id: tb.barberId,
    type: tb.type,
    label: tb.label,
    date: tb.date,
    start_time: tb.startTime,
    end_time: tb.endTime,
    recurring: tb.recurring,
    created_at: tb.createdAt,
    barber_name: tb.barber?.name ?? null,
  };
}

export function toApiEscalation(e: Escalation & { client?: { name: string } | null }) {
  return {
    id: e.id,
    barbershop_id: e.barbershopId,
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
    barbershop_id: a.barbershopId,
    user_name: a.userName,
    action: a.action,
    details: a.details,
    created_at: a.createdAt,
  };
}

export function toApiBusinessHours(h: BusinessHours) {
  return {
    id: h.id,
    barbershop_id: h.barbershopId,
    weekday: h.weekday,
    opens_at: h.opensAt,
    closes_at: h.closesAt,
    closed: h.closed,
  };
}

export function toApiReview(r: {
  id: number;
  appointmentId: number;
  barbershopId: number;
  barberId: number;
  clientId: number;
  rating: number;
  comment: string | null;
  createdAt: Date;
  client: { name: string };
  barber: { name: string };
  appointment: { service: { name: string } };
}) {
  return {
    id: r.id,
    appointment_id: r.appointmentId,
    barbershop_id: r.barbershopId,
    barber_id: r.barberId,
    client_id: r.clientId,
    rating: r.rating,
    comment: r.comment,
    created_at: r.createdAt,
    client_name: r.client.name,
    barber_name: r.barber.name,
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
  service: { name: string; priceCents: number };
  barber: { name: string };
  productSales: { quantity: number; product: { name: string; priceCents: number } }[];
}) {
  return {
    id: a.id,
    date: localDateStr(a.date),
    start_time: a.startTime,
    status: a.status,
    service_name: a.service.name,
    barber_name: a.barber.name,
    price_cents: a.service.priceCents,
    products: a.productSales.map((ps) => ({
      name: ps.product.name,
      quantity: ps.quantity,
      price_cents: ps.product.priceCents,
    })),
  };
}
