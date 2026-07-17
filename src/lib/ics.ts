import type { AppointmentDTO } from "@/modules/appointments/appointments.types.js";

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function toIcsDateTime(date: string, time: string): string {
  const [y, m, d] = date.split("-");
  const [h, min] = time.split(":");
  return `${y}${m}${d}T${pad(Number(h))}${pad(Number(min))}00`;
}

function escapeText(text: unknown): string {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export function generateIcs(appointment: AppointmentDTO): string {
  const dtStart = toIcsDateTime(appointment.date, appointment.startTime);
  const dtEnd = toIcsDateTime(appointment.date, appointment.endTime);
  const now = new Date();
  const dtStamp = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const summary = `${appointment.serviceName} - ${appointment.barbershopName}`;
  const description = `Agendamento com ${appointment.barberName}. Serviço: ${appointment.serviceName}. Valor: R$ ${Math.round(
    appointment.priceCents / 100
  )}`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BarbeariaSaaS//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:agendamento-${appointment.id}@barbearia-saas`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LOCATION:${escapeText(appointment.barbershopName)}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.join("\r\n");
}
