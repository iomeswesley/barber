import { describe, it, expect } from "vitest";
import { normalizeLocale, metaLanguageCode, weekdayName, languageLabel, formatMoney } from "./locale.js";

describe("normalizeLocale", () => {
  it("aceita os idiomas suportados", () => {
    expect(normalizeLocale("pt-BR")).toBe("pt-BR");
    expect(normalizeLocale("fr")).toBe("fr");
    expect(normalizeLocale("en")).toBe("en");
  });

  it("cai em pt-BR pra valor desconhecido, vazio ou nulo (nunca quebra envio/prompt)", () => {
    expect(normalizeLocale("de")).toBe("pt-BR");
    expect(normalizeLocale("")).toBe("pt-BR");
    expect(normalizeLocale(null)).toBe("pt-BR");
    expect(normalizeLocale(undefined)).toBe("pt-BR");
  });
});

describe("metaLanguageCode", () => {
  it("converte BCP47 do banco pro código de Message Template da Meta", () => {
    expect(metaLanguageCode("pt-BR")).toBe("pt_BR");
    expect(metaLanguageCode("fr")).toBe("fr");
    expect(metaLanguageCode("en")).toBe("en");
    expect(metaLanguageCode(undefined)).toBe("pt_BR");
  });
});

describe("weekdayName / languageLabel", () => {
  it("devolve o dia da semana no idioma (0 = domingo)", () => {
    expect(weekdayName("pt-BR", 0)).toBe("domingo");
    expect(weekdayName("fr", 1)).toBe("lundi");
    expect(weekdayName("en", 6)).toBe("Saturday");
  });

  it("nomeia o idioma em português pra instruir o bot", () => {
    expect(languageLabel("fr")).toBe("francês");
    expect(languageLabel("en")).toBe("inglês");
    expect(languageLabel("pt-BR")).toBe("português do Brasil");
  });
});

describe("formatMoney", () => {
  it("BRL em pt-BR mantém o formato histórico do bot (arredondado, sem centavos)", () => {
    expect(formatMoney(9900)).toBe("R$ 99");
    expect(formatMoney(9950)).toBe("R$ 100");
    expect(formatMoney(0)).toBe("R$ 0");
  });

  it("EUR mostra centavos só quando existem, sem arredondar preço", () => {
    const whole = formatMoney(1500, "EUR", "fr");
    expect(whole).toContain("15");
    expect(whole).toContain("€");
    expect(whole).not.toMatch(/[.,]\d{2}/);

    const withCents = formatMoney(1550, "EUR", "en");
    expect(withCents).toContain("15.50");
    expect(withCents).toContain("€");
  });

  it("BRL fora de pt-BR usa Intl (não o formato histórico)", () => {
    expect(formatMoney(9900, "BRL", "en")).toContain("R$");
  });
});
