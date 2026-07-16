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
  barbershopId?: number;
  barberId?: number;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
}

export async function getAppointments(filter: GetAppointmentsFilter = {}): Promise<AppointmentDTO[]> {
  const { barbershopId, barberId, date, dateFrom, dateTo } = filter;
  const appointments = await prisma.appointment.findMany({
    where: {
      status: { not: "cancelled" },
      ...(barbershopId ? { barbershopId } : {}),
      ...(barberId ? { barberId } : {}),
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
  barbershopId: number;
  barberId: number;
  serviceId: number;
  clientId: number;
  date: string;
  startTime: string;
  endTime: string;
}): Promise<AppointmentDTO> {
  const created = await prisma.appointment.create({
    data: {
      barbershopId: data.barbershopId,
      barberId: data.barberId,
      serviceId: data.serviceId,
      clientId: data.clientId,
      date: new Date(`${data.date}T00:00:00`),
      startTime: data.startTime,
      endTime: data.endTime,
    },
    include: appointmentInclude,
  });
  return toAppointmentDTO(created as AppointmentWithRelations);
}

export async function findConflict(
  barberId: number,
  date: string,
  startTime: string,
  endTime: string,
  excludeId?: number
) {
  return prisma.appointment.findFirst({
    where: {
      barberId,
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

export async function updateAppointmentFields(
  id: number,
  data: { serviceId?: number; endTime?: string; status?: "confirmed" | "no_show" }
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
