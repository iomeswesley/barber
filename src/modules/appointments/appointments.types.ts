import type { Appointment, AppointmentStatus } from "@prisma/client";

// Forma "achatada" do agendamento com os nomes relacionados já resolvidos —
// espelha o shape que barbearia-bot/src/db.js retornava via JOIN, pra manter
// o consumo (dashboard, chat, frontend) o mais parecido possível.
export interface AppointmentDTO {
  id: number;
  businessId: number;
  professionalId: number;
  serviceId: number;
  clientId: number;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  reminderSentAt: Date | null;
  reviewPromptedAt: Date | null;
  createdAt: Date;
  barberName: string;
  barberCommissionPercent?: number;
  serviceName: string;
  durationMin: number;
  priceCents: number;
  clientName: string;
  clientPhone: string;
  barbershopName: string;
  notes: string | null;
}

export const appointmentInclude = {
  professional: true,
  service: true,
  client: true,
  business: true,
} as const;

export type AppointmentWithRelations = Appointment & {
  professional: { name: string; serviceCommissionPercent: unknown };
  service: { name: string; durationMin: number; priceCents: number };
  client: { name: string; phone: string };
  business: { name: string };
};

function dateToStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function toAppointmentDTO(a: AppointmentWithRelations): AppointmentDTO {
  return {
    id: a.id,
    businessId: a.businessId,
    professionalId: a.professionalId,
    serviceId: a.serviceId,
    clientId: a.clientId,
    date: dateToStr(a.date),
    startTime: a.startTime,
    endTime: a.endTime,
    status: a.status,
    reminderSentAt: a.reminderSentAt,
    reviewPromptedAt: a.reviewPromptedAt,
    createdAt: a.createdAt,
    barberName: a.professional.name,
    barberCommissionPercent: Number(a.professional.serviceCommissionPercent),
    serviceName: a.service.name,
    durationMin: a.service.durationMin,
    // priceChargedCents é sempre gravado no momento da criação (createAppointment)
    // — com desconto/grátis se um plano de assinatura se aplicou, ou o preço de
    // tabela da época caso contrário. O fallback pro preço atual do serviço
    // aqui existe só pra agendamentos gravados antes dessa correção, quando
    // "sem plano" ainda salvava null e reagia a mudanças de preço do serviço
    // retroativamente (o próprio bug que motivou essa mudança).
    priceCents: a.priceChargedCents ?? a.service.priceCents,
    clientName: a.client.name,
    clientPhone: a.client.phone,
    barbershopName: a.business.name,
    notes: a.notes,
  };
}
