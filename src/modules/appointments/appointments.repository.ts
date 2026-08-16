import { prisma } from "@/lib/prisma.js";
import { appointmentInclude, toAppointmentDTO, type AppointmentDTO, type AppointmentWithRelations } from "./appointments.types.js";

export async function getAppointmentById(id: number): Promise<AppointmentDTO | null> {
  const appointment = await prisma.appointment.findUnique({
    where: { id },
    include: appointmentInclude,
  });
  return appointment ? toAppointmentDTO(appointment as AppointmentWithRelations) : null;
}

export interface GetAppointmentsFilter {
  businessId?: number;
  professionalId?: number;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
}

export async function getAppointments(filter: GetAppointmentsFilter = {}): Promise<AppointmentDTO[]> {
  const { businessId, professionalId, date, dateFrom, dateTo } = filter;
  const appointments = await prisma.appointment.findMany({
    where: {
      status: { not: "cancelled" },
      ...(businessId ? { businessId } : {}),
      ...(professionalId ? { professionalId } : {}),
      ...(date ? { date: new Date(`${date}T00:00:00`) } : {}),
      ...(dateFrom || dateTo
        ? {
            date: {
              ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00`) } : {}),
              ...(dateTo ? { lte: new Date(`${dateTo}T00:00:00`) } : {}),
            },
          }
        : {}),
    },
    include: appointmentInclude,
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
  return appointments.map((a) => toAppointmentDTO(a as AppointmentWithRelations));
}

export async function insertAppointment(data: {
  businessId: number;
  professionalId: number;
  serviceId: number;
  clientId: number;
  date: string;
  startTime: string;
  endTime: string;
  priceChargedCents?: number | null;
  clientPlanSubscriptionId?: number | null;
  planCreditConsumed?: boolean;
}): Promise<AppointmentDTO> {
  const created = await prisma.appointment.create({
    data: {
      businessId: data.businessId,
      professionalId: data.professionalId,
      serviceId: data.serviceId,
      clientId: data.clientId,
      date: new Date(`${data.date}T00:00:00`),
      startTime: data.startTime,
      endTime: data.endTime,
      priceChargedCents: data.priceChargedCents ?? null,
      clientPlanSubscriptionId: data.clientPlanSubscriptionId ?? null,
      planCreditConsumed: data.planCreditConsumed ?? false,
    },
    include: appointmentInclude,
  });
  return toAppointmentDTO(created as AppointmentWithRelations);
}

export async function findConflict(
  professionalId: number,
  date: string,
  startTime: string,
  endTime: string,
  excludeId?: number
) {
  return prisma.appointment.findFirst({
    where: {
      professionalId,
      date: new Date(`${date}T00:00:00`),
      status: { not: "cancelled" },
      startTime: { lt: endTime },
      endTime: { gt: startTime },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
}

export function cancelAppointment(id: number) {
  return prisma.appointment.update({ where: { id }, data: { status: "cancelled" } });
}

export function setConfirmationToken(id: number, token: string) {
  return prisma.appointment.update({ where: { id }, data: { confirmationToken: token } });
}

// Atômico: só confirma (scheduled -> confirmed) se o token bater E o
// agendamento ainda estiver "scheduled" — updateMany com esse where composto
// evita corrida (dois cliques quase simultâneos) e evita reabrir um
// agendamento já cancelado/no_show clicando num link de lembrete antigo.
// count === 0 cobre token inválido, já confirmado, cancelado ou no_show.
export async function confirmAppointmentByToken(token: string): Promise<AppointmentDTO | null> {
  const { count } = await prisma.appointment.updateMany({
    where: { confirmationToken: token, status: "scheduled" },
    data: { status: "confirmed" },
  });
  if (count === 0) return null;
  const appointment = await prisma.appointment.findFirst({ where: { confirmationToken: token }, include: appointmentInclude });
  return appointment ? toAppointmentDTO(appointment as AppointmentWithRelations) : null;
}

export async function updateAppointmentFields(
  id: number,
  data: { serviceId?: number; endTime?: string; status?: "confirmed" | "no_show"; notes?: string | null }
) {
  return prisma.appointment.update({ where: { id }, data });
}

export function updateClientName(clientId: number, name: string) {
  return prisma.client.update({ where: { id: clientId }, data: { name } });
}

export function markReminderSent(id: number) {
  return prisma.appointment.update({ where: { id }, data: { reminderSentAt: new Date() } });
}

export function markReviewPrompted(appointmentId: number) {
  return prisma.appointment.update({ where: { id: appointmentId }, data: { reviewPromptedAt: new Date() } });
}
