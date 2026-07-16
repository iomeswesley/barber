import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/middleware/errorHandler.js";
import { timeToMinutes, minutesToTime, localDateStr, normalizePhone } from "@/lib/time.js";
import { getBarbershop, getBusinessHoursForDate } from "@/modules/barbershops/barbershops.repository.js";
import { getService } from "@/modules/services/services.repository.js";
import { getBlocksFor } from "@/modules/timeBlocks/timeBlocks.repository.js";
import { getClientByPhone } from "@/modules/clients/clients.repository.js";
import {
  getAppointmentById,
  getAppointments,
  insertAppointment,
  findConflict,
  cancelAppointment as cancelAppointmentRow,
  updateAppointmentFields,
  updateClientName,
} from "./appointments.repository.js";
import { appointmentInclude, toAppointmentDTO, type AppointmentDTO, type AppointmentWithRelations } from "./appointments.types.js";

export async function getAvailableSlots(
  barbershopId: number,
  barberId: number,
  serviceId: number,
  date: string
): Promise<string[]> {
  const [shop, service] = await Promise.all([getBarbershop(barbershopId), getService(serviceId)]);
  if (!shop || !service) return [];

  const hours = await getBusinessHoursForDate(barbershopId, date);
  if (!hours || hours.closed) return [];

  const openMin = timeToMinutes(hours.opensAt);
  const closeMin = timeToMinutes(hours.closesAt);
  const duration = service.durationMin;

  const existing = await prisma.appointment.findMany({
    where: { barberId, date: new Date(`${date}T00:00:00`), status: { not: "cancelled" } },
    select: { startTime: true, endTime: true },
  });
  const busy = existing.map((a) => ({ start: timeToMinutes(a.startTime), end: timeToMinutes(a.endTime) }));
  busy.push(...(await getBlocksFor(barbershopId, barberId, date)));

  const now = new Date();
  const isToday = date === now.toISOString().slice(0, 10);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const slots: string[] = [];
  for (let start = openMin; start + duration <= closeMin; start += 30) {
    if (isToday && start <= nowMin) continue;
    const end = start + duration;
    const overlaps = busy.some((b) => start < b.end && end > b.start);
    if (!overlaps) slots.push(minutesToTime(start));
  }
  return slots;
}

// Varre dia a dia (pulando dias em que a barbearia está fechada) até achar a
// próxima data com horários livres — evita o modelo de IA ficar chutando uma
// data por vez e queimando uma tool call por tentativa.
export async function findNextAvailableDay(
  barbershopId: number,
  barberId: number,
  serviceId: number,
  fromDateStr: string,
  maxDays = 14
): Promise<{ date: string; horarios_disponiveis: string[] } | null> {
  const start = new Date(`${fromDateStr}T12:00:00`);
  for (let offset = 0; offset < maxDays; offset++) {
    const day = new Date(start);
    day.setDate(day.getDate() + offset);
    const dateStr = localDateStr(day);
    const slots = await getAvailableSlots(barbershopId, barberId, serviceId, dateStr);
    if (slots.length > 0) return { date: dateStr, horarios_disponiveis: slots };
  }
  return null;
}

export async function createAppointment(input: {
  barbershopId: number;
  barberId: number;
  serviceId: number;
  clientId: number;
  date: string;
  startTime: string;
}): Promise<AppointmentDTO> {
  const service = await getService(input.serviceId);
  if (!service) throw new AppError("Serviço não encontrado", 404);
  const endTime = minutesToTime(timeToMinutes(input.startTime) + service.durationMin);

  const conflict = await findConflict(input.barberId, input.date, input.startTime, endTime);
  if (conflict) {
    throw new AppError("Esse horário acabou de ser ocupado. Escolha outro horário.");
  }

  const startMin = timeToMinutes(input.startTime);
  const endMin = timeToMinutes(endTime);
  const blocks = await getBlocksFor(input.barbershopId, input.barberId, input.date);
  const blocked = blocks.some((b) => startMin < b.end && endMin > b.start);
  if (blocked) {
    throw new AppError("Esse horário está bloqueado (folga, feriado ou intervalo). Escolha outro horário.");
  }

  return insertAppointment({ ...input, endTime });
}

export async function rescheduleAppointment(id: number, newDate: string, newStartTime: string): Promise<AppointmentDTO> {
  const appointment = await getAppointmentById(id);
  if (!appointment) throw new AppError("Agendamento não encontrado", 404);

  const service = await getService(appointment.serviceId);
  if (!service) throw new AppError("Serviço não encontrado", 404);
  const newEndTime = minutesToTime(timeToMinutes(newStartTime) + service.durationMin);

  const conflict = await findConflict(appointment.barberId, newDate, newStartTime, newEndTime, id);
  if (conflict) throw new AppError("Esse novo horário já está ocupado. Escolha outro.");

  const startMin = timeToMinutes(newStartTime);
  const endMin = timeToMinutes(newEndTime);
  const blocks = await getBlocksFor(appointment.barbershopId, appointment.barberId, newDate);
  const blocked = blocks.some((b) => startMin < b.end && endMin > b.start);
  if (blocked) throw new AppError("Esse novo horário está bloqueado (folga, feriado ou intervalo). Escolha outro.");

  await prisma.appointment.update({
    where: { id },
    data: { date: new Date(`${newDate}T00:00:00`), startTime: newStartTime, endTime: newEndTime },
  });
  return (await getAppointmentById(id))!;
}

export async function cancelAppointment(id: number): Promise<AppointmentDTO> {
  await cancelAppointmentRow(id);
  return (await getAppointmentById(id))!;
}

// Usado quando um bloqueio de última hora é criado, pra achar agendamentos já
// feitos que passam a cair dentro da janela bloqueada, pra avisar os clientes.
export async function getAffectedAppointments(
  barbershopId: number,
  barberId: number | null,
  date: string,
  startTime: string,
  endTime: string
): Promise<AppointmentDTO[]> {
  const now = new Date();
  const all = await getAppointments({ barbershopId, barberId: barberId || undefined, date });
  const endMin = timeToMinutes(endTime);
  const startMin = timeToMinutes(startTime);
  return all
    .filter((a) => a.status === "confirmed")
    .filter((a) => timeToMinutes(a.startTime) < endMin && timeToMinutes(a.endTime) > startMin)
    .filter((a) => new Date(`${a.date}T${a.startTime}:00`) > now);
}

export async function updateAppointmentDetails(
  id: number,
  { clientName, serviceId, status }: { clientName?: string; serviceId?: number | string; status?: string }
): Promise<AppointmentDTO> {
  const appointment = await getAppointmentById(id);
  if (!appointment) throw new AppError("Agendamento não encontrado", 404);

  if (clientName && clientName.trim()) {
    await updateClientName(appointment.clientId, clientName.trim());
  }

  if (serviceId && Number(serviceId) !== appointment.serviceId) {
    const service = await getService(Number(serviceId));
    if (!service) throw new AppError("Serviço não encontrado");
    const newEndTime = minutesToTime(timeToMinutes(appointment.startTime) + service.durationMin);
    await updateAppointmentFields(id, { serviceId: Number(serviceId), endTime: newEndTime });
  }

  if (status && ["confirmed", "no_show"].includes(status)) {
    await updateAppointmentFields(id, { status: status as "confirmed" | "no_show" });
  }

  return (await getAppointmentById(id))!;
}

export async function getAppointmentsByClientPhone(
  clientPhone: string,
  barbershopId: number,
  { upcomingOnly = true } = {}
): Promise<AppointmentDTO[]> {
  const client = await getClientByPhone(clientPhone);
  if (!client) return [];
  const now = new Date();
  const appointments = await prisma.appointment.findMany({
    where: {
      status: { not: "cancelled" },
      clientId: client.id,
      barbershopId,
      ...(upcomingOnly
        ? {
            OR: [
              { date: { gt: new Date(`${localDateStr(now)}T00:00:00`) } },
              {
                date: new Date(`${localDateStr(now)}T00:00:00`),
                endTime: { gt: `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}` },
              },
            ],
          }
        : {}),
    },
    include: appointmentInclude,
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
  return appointments.map((a) => toAppointmentDTO(a as AppointmentWithRelations));
}

// Agendamentos passados (que já aconteceram) pro histórico de autoatendimento do
// cliente — distinto de getAppointmentsByClientPhone(upcomingOnly:true), que só olha pra frente.
export async function getClientAppointmentHistory(
  clientPhone: string,
  barbershopId: number,
  limit = 20
): Promise<AppointmentDTO[]> {
  const client = await getClientByPhone(clientPhone);
  if (!client) return [];
  const now = new Date();
  const todayDate = new Date(`${localDateStr(now)}T00:00:00`);
  const nowTimeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

  const appointments = await prisma.appointment.findMany({
    where: {
      clientId: client.id,
      barbershopId,
      status: { not: "cancelled" },
      OR: [{ date: { lt: todayDate } }, { date: todayDate, endTime: { lte: nowTimeStr } }],
    },
    include: appointmentInclude,
    orderBy: [{ date: "desc" }, { startTime: "desc" }],
    take: limit,
  });
  return appointments.map((a) => toAppointmentDTO(a as AppointmentWithRelations));
}

export async function getClientLastAppointment(clientId: number, barbershopId: number): Promise<AppointmentDTO | null> {
  const now = new Date();
  const todayDate = new Date(`${localDateStr(now)}T00:00:00`);
  const nowTimeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  const appointment = await prisma.appointment.findFirst({
    where: {
      clientId,
      barbershopId,
      status: "confirmed",
      OR: [{ date: { lt: todayDate } }, { date: todayDate, endTime: { lte: nowTimeStr } }],
    },
    include: appointmentInclude,
    orderBy: [{ date: "desc" }, { startTime: "desc" }],
  });
  return appointment ? toAppointmentDTO(appointment as AppointmentWithRelations) : null;
}

export async function getAppointmentsNeedingReminder(windowStartMin = 55, windowEndMin = 65): Promise<AppointmentDTO[]> {
  const now = new Date();
  const from = new Date(now.getTime() + windowStartMin * 60000);
  const to = new Date(now.getTime() + windowEndMin * 60000);

  // Compara "YYYY-MM-DD HH:MM" como string pra achar agendamentos cujo início cai
  // dentro da janela de 55–65 min a partir de agora, cruzando fronteiras de dia.
  const fromStr = `${localDateStr(from)} ${from.getHours().toString().padStart(2, "0")}:${from.getMinutes().toString().padStart(2, "0")}`;
  const toStr = `${localDateStr(to)} ${to.getHours().toString().padStart(2, "0")}:${to.getMinutes().toString().padStart(2, "0")}`;

  const appointments = await prisma.appointment.findMany({
    where: { status: { not: "cancelled" }, reminderSentAt: null },
    include: appointmentInclude,
  });
  return appointments
    .map((a) => toAppointmentDTO(a as AppointmentWithRelations))
    .filter((a) => {
      const key = `${a.date} ${a.startTime}`;
      return key >= fromStr && key <= toStr;
    });
}

// Usado pelo cron diário (Vercel Cron roda no máximo 1x/dia no plano Hobby):
// pega todos os agendamentos de hoje ainda não avisados, em vez da janela
// de 55–65 min usada por getAppointmentsNeedingReminder (pensada pra um
// scheduler contínuo de 1 em 1 minuto).
export async function getTodaysAppointmentsForReminder(): Promise<AppointmentDTO[]> {
  const today = localDateStr(new Date());
  const appointments = await prisma.appointment.findMany({
    where: { status: { not: "cancelled" }, reminderSentAt: null, date: new Date(`${today}T00:00:00`) },
    include: appointmentInclude,
  });
  return appointments.map((a) => toAppointmentDTO(a as AppointmentWithRelations));
}

export async function getUnreviewedCompletedAppointment(clientPhone: string, barbershopId: number): Promise<AppointmentDTO | null> {
  const client = await getClientByPhone(normalizePhone(clientPhone) ? clientPhone : clientPhone);
  if (!client) return null;
  const now = new Date();
  const todayDate = new Date(`${localDateStr(now)}T00:00:00`);
  const nowTimeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  const appointment = await prisma.appointment.findFirst({
    where: {
      clientId: client.id,
      barbershopId,
      status: { not: "cancelled" },
      review: null,
      reviewPromptedAt: null,
      OR: [{ date: { lt: todayDate } }, { date: todayDate, endTime: { lte: nowTimeStr } }],
    },
    include: appointmentInclude,
    orderBy: [{ date: "desc" }, { endTime: "desc" }],
  });
  return appointment ? toAppointmentDTO(appointment as AppointmentWithRelations) : null;
}
