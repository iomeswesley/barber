import { describe, it, expect } from "vitest";
import { generateIcs } from "./ics.js";
import type { AppointmentDTO } from "@/modules/appointments/appointments.types.js";

function makeAppointment(overrides: Partial<AppointmentDTO> = {}): AppointmentDTO {
  return {
    id: 42,
    barbershopId: 1,
    barberId: 1,
    serviceId: 1,
    clientId: 1,
    date: "2026-07-20",
    startTime: "14:00",
    endTime: "14:45",
    status: "confirmed",
    reminderSentAt: null,
    reviewPromptedAt: null,
    createdAt: new Date(),
    barberName: "Carlos",
    serviceName: "Corte Masculino",
    durationMin: 45,
    priceCents: 4000,
    clientName: "Cliente Teste",
    clientPhone: "11999998888",
    barbershopName: "Barbearia Vintage",
    ...overrides,
  };
}

describe("generateIcs", () => {
  it("gera um VCALENDAR válido com os horários corretos", () => {
    const ics = generateIcs(makeAppointment());
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("DTSTART:20260720T140000");
    expect(ics).toContain("DTEND:20260720T144500");
    expect(ics).toContain("UID:agendamento-42@barbearia-saas");
  });

  it("escapa vírgula, ponto-e-vírgula e barra invertida no texto livre", () => {
    const ics = generateIcs(makeAppointment({ serviceName: "Corte; Barba, Sobrancelha \\ Premium" }));
    expect(ics).toContain("Corte\\; Barba\\, Sobrancelha \\\\ Premium");
  });
});
