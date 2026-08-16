import { describe, it, expect } from "vitest";
import { parseIcs } from "./icsParser.js";

describe("parseIcs", () => {
  it("extrai um evento com horário (DATETIME)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:evento-1@example.com",
      "SUMMARY:Consulta particular",
      "DTSTART:20260901T140000",
      "DTEND:20260901T153000",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseIcs(ics);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      uid: "evento-1@example.com",
      summary: "Consulta particular",
      date: "2026-09-01",
      startTime: "14:00",
      endTime: "15:30",
      allDay: false,
    });
  });

  it("evento all-day (só DATE, sem horário) vira bloqueio 00:00-23:59", () => {
    const ics = ["BEGIN:VEVENT", "UID:dia-inteiro", "SUMMARY:Feriado", "DTSTART;VALUE=DATE:20260907", "END:VEVENT"].join("\n");
    const events = parseIcs(ics);
    expect(events[0]).toMatchObject({ date: "2026-09-07", startTime: "00:00", endTime: "23:59", allDay: true });
  });

  it("ignora linhas fora de BEGIN/END:VEVENT e eventos sem DTSTART", () => {
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "SUMMARY:Sem data", "END:VEVENT", "END:VCALENDAR"].join("\n");
    expect(parseIcs(ics)).toHaveLength(0);
  });

  it("desdobra linha continuada (RFC 5545 line folding)", () => {
    // RFC 5545: a linha continuada tem UM espaço/tab inicial que é o
    // marcador de "dobra" em si (removido ao desdobrar) — se o texto
    // original tinha um espaço ali, ele precisa estar DEPOIS desse marcador.
    const ics = ["BEGIN:VEVENT", "UID:dobrada", "SUMMARY:Reunião", "  muito longa continuada", "DTSTART:20260901T090000", "END:VEVENT"].join("\r\n");
    const events = parseIcs(ics);
    expect(events[0]?.summary).toBe("Reunião muito longa continuada");
  });

  it("processa múltiplos eventos no mesmo arquivo", () => {
    const ics = [
      "BEGIN:VEVENT",
      "UID:1",
      "DTSTART:20260901T090000",
      "DTEND:20260901T100000",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:2",
      "DTSTART:20260902T110000",
      "DTEND:20260902T120000",
      "END:VEVENT",
    ].join("\n");
    expect(parseIcs(ics)).toHaveLength(2);
  });
});
