import { describe, it, expect } from "vitest";
import { timeToMinutes, minutesToTime, localDateStr, weekdayForDateStr, normalizePhone, dateOnly, dbDateToStr } from "./time.js";

describe("timeToMinutes", () => {
  it("converte HH:MM pra minutos desde meia-noite", () => {
    expect(timeToMinutes("09:00")).toBe(540);
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("23:59")).toBe(1439);
  });
});

describe("minutesToTime", () => {
  it("é o inverso de timeToMinutes", () => {
    for (const t of ["09:00", "00:05", "23:59", "13:30"]) {
      expect(minutesToTime(timeToMinutes(t))).toBe(t);
    }
  });
});

describe("localDateStr", () => {
  it("formata como YYYY-MM-DD com zero à esquerda", () => {
    expect(localDateStr(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(localDateStr(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("weekdayForDateStr", () => {
  it("bate com a convenção 0=Domingo...6=Sábado", () => {
    // 2026-07-19 é um domingo.
    expect(weekdayForDateStr("2026-07-19")).toBe(0);
    expect(weekdayForDateStr("2026-07-20")).toBe(1);
    expect(weekdayForDateStr("2026-07-25")).toBe(6);
  });

  it("não vira o dia por causa de fuso horário (constrói ao meio-dia local)", () => {
    // Regressão: se construísse a data à meia-noite UTC, em fusos negativos
    // (ex: America/Sao_Paulo, UTC-3) a data local viraria o dia anterior.
    for (let d = 1; d <= 28; d++) {
      const ds = `2026-03-${d.toString().padStart(2, "0")}`;
      const expected = new Date(2026, 2, d).getDay();
      expect(weekdayForDateStr(ds)).toBe(expected);
    }
  });
});

describe("normalizePhone", () => {
  it("remove tudo que não é dígito", () => {
    expect(normalizePhone("(11) 99999-8888")).toBe("11999998888");
    expect(normalizePhone("+55 11 99999-8888")).toBe("5511999998888");
  });

  it("lida com valores vazios/nulos sem lançar erro", () => {
    expect(normalizePhone(undefined)).toBe("");
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone("")).toBe("");
  });
});

// Coluna @db.Date: o dia gravado/lido não pode depender do fuso do processo.
// `new Date("2026-09-18T00:00:00")` (meia-noite LOCAL) gravava 17/09 em fuso a
// leste de UTC (Luxemburgo); dateOnly é meia-noite UTC e vale em qualquer fuso.
describe("dateOnly / dbDateToStr (independentes do fuso do processo)", () => {
  it("dateOnly é sempre meia-noite UTC", () => {
    expect(dateOnly("2026-09-18").toISOString()).toBe("2026-09-18T00:00:00.000Z");
  });

  it("ida e volta preserva o dia, inclusive nas viradas de horário de verão (Europa e Brasil)", () => {
    for (const day of ["2026-01-01", "2026-03-29", "2026-03-30", "2026-10-25", "2026-10-26", "2026-11-01", "2026-12-31", "2028-02-29"]) {
      expect(dbDateToStr(dateOnly(day))).toBe(day);
    }
  });

  it("dbDateToStr lê o dia UTC de um valor @db.Date vindo do Prisma", () => {
    expect(dbDateToStr(new Date("2026-09-18T00:00:00.000Z"))).toBe("2026-09-18");
  });
});
