import { describe, it, expect } from "vitest";
import { timeToMinutes, minutesToTime, localDateStr, weekdayForDateStr, normalizePhone } from "./time.js";

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
