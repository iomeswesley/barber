import { describe, it, expect } from "vitest";
import { generateIcs, generateGoogleCalendarUrl } from "./ics.js";
import type { AppointmentDTO } from "@/modules/appointments/appointments.types.js";

function makeAppointment(overrides: Partial<AppointmentDTO> = {}): AppointmentDTO {
  return {
    id: 42,
    businessId: 1,
    professionalId: 1,
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
    notes: null,
    confirmationToken: null,
    googleEventId: null,
    paymentMethod: null,
    couponId: null,
    clientPlanSubscriptionId: null,
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

// Achado em produção (2026-09-05): link cru de .ics baixa o arquivo sem
// fazer nada útil no Android — generateGoogleCalendarUrl vira a opção
// principal enviada pelo bot (ver instrução 6 em buildStableSystemPrompt,
// chatEngine.ts), um clique só, sem download.
describe("generateGoogleCalendarUrl", () => {
  it("gera uma URL do Google Agenda com os campos certos", () => {
    const url = generateGoogleCalendarUrl(makeAppointment());
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(parsed.searchParams.get("action")).toBe("TEMPLATE");
    expect(parsed.searchParams.get("text")).toBe("Corte Masculino - Barbearia Vintage");
    expect(parsed.searchParams.get("dates")).toBe("20260720T140000/20260720T144500");
    expect(parsed.searchParams.get("location")).toBe("Barbearia Vintage");
    expect(parsed.searchParams.get("ctz")).toBe("America/Sao_Paulo");
  });

  it("inclui barbeiro, serviço e preço na descrição", () => {
    const url = generateGoogleCalendarUrl(makeAppointment({ barberName: "Diego", priceCents: 4000 }));
    const details = new URL(url).searchParams.get("details");
    expect(details).toContain("Diego");
    expect(details).toContain("R$ 40");
  });
});
