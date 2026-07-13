function pad(n) {
  return n.toString().padStart(2, "0");
}

function toIcsDateTime(date, time) {
  const [y, m, d] = date.split("-");
  const [h, min] = time.split(":");
  return `${y}${m}${d}T${pad(Number(h))}${pad(Number(min))}00`;
}

function escapeText(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export function generateIcs(appointment) {
  const dtStart = toIcsDateTime(appointment.date, appointment.start_time);
  const dtEnd = toIcsDateTime(appointment.date, appointment.end_time);
  const now = new Date();
  const dtStamp =
    now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const summary = `${appointment.service_name} - ${appointment.barbershop_name}`;
  const description = `Agendamento com ${appointment.barber_name}. Serviço: ${appointment.service_name}. Valor: R$ ${(
    appointment.price_cents / 100
  ).toFixed(2)}`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BarbeariaBot//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:agendamento-${appointment.id}@barbearia-bot`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LOCATION:${escapeText(appointment.barbershop_name)}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.join("\r\n");
}
