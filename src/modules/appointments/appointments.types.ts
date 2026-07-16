import type { Appointment, AppointmentStatus } from "@prisma/client";

// Forma "achatada" do agendamento com os nomes relacionados já resolvidos —
// espelha o shape que barbearia-bot/src/db.js retornava via JOIN, pra manter
// o consumo (dashboard, chat, frontend) o mais parecido possível.
export interface AppointmentDTO {
  id: number;
  barbershopId: number;
  barberId: number;
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
}

export const appointmentInclude = {
  barber: true,
  service: true,
  client: true,
  barbershop: true,
} as const;

export type AppointmentWithRelations = Appointment & {
  barber: { name: string; commissionPercent: unknown };
  service: { name: string; durationMin: number; priceCents: number };
  client: { name: string; phone: string };
  barbershop: { name: string };
};

function dateToStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function toAppointmentDTO(a: AppointmentWithRelations): AppointmentDTO {
  return {
    id: a.id,
    barbershopId: a.barbershopId,
    barberId: a.barberId,
    serviceId: a.serviceId,
    clientId: a.clientId,
    date: dateToStr(a.date),
    startTime: a.startTime,
    endTime: a.endTime,
    status: a.status,
    reminderSentAt: a.reminderSentAt,
    reviewPromptedAt: a.reviewPromptedAt,
    createdAt: a.createdAt,
    barberName: a.barber.name,
    barberCommissionPercent: Number(a.barber.commissionPercent),
    serviceName: a.service.name,
    durationMin: a.service.durationMin,
    priceCents: a.service.priceCents,
    clientName: a.client.name,
    clientPhone: a.client.phone,
    barbershopName: a.barbershop.name,
  };
}
