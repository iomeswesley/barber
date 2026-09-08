import { describe, it, expect } from "vitest";
import { isKnownNonCustomerSender } from "./nonCustomerSenders.js";

// Achado em produção (2026-09-08): em modo Coexistência, a Claro mandou
// mensagem pro número da barbearia e o bot tentou agendar corte de cabelo
// com a operadora. Ver src/modules/whatsapp/whatsapp.routes.ts.
describe("isKnownNonCustomerSender", () => {
  it("reconhece a Claro (o caso real que motivou isso)", () => {
    expect(isKnownNonCustomerSender("Claro")).toBe(true);
  });

  it("reconhece outras marcas conhecidas (operadora, banco, delivery)", () => {
    expect(isKnownNonCustomerSender("Vivo")).toBe(true);
    expect(isKnownNonCustomerSender("Nubank")).toBe(true);
    expect(isKnownNonCustomerSender("iFood")).toBe(true);
    expect(isKnownNonCustomerSender("Itaú")).toBe(true); // acentuação normalizada
  });

  it("ignora maiúsculas/minúsculas e espaço nas pontas", () => {
    expect(isKnownNonCustomerSender("  CLARO  ")).toBe(true);
    expect(isKnownNonCustomerSender("claro")).toBe(true);
  });

  it("reconhece sufixo comum (\"Claro Oficial\", \"iFood Brasil\")", () => {
    expect(isKnownNonCustomerSender("Claro Oficial")).toBe(true);
    expect(isKnownNonCustomerSender("iFood Brasil")).toBe(true);
  });

  it("NÃO reconhece nome de cliente real, mesmo parecido", () => {
    expect(isKnownNonCustomerSender("Clarissa Souza")).toBe(false);
    expect(isKnownNonCustomerSender("Wesley")).toBe(false);
    expect(isKnownNonCustomerSender("Carlos Barbeiro")).toBe(false);
  });

  it("nunca filtra quando não há pushName — ausência de nome não é sinal de nada", () => {
    expect(isKnownNonCustomerSender(undefined)).toBe(false);
    expect(isKnownNonCustomerSender(null)).toBe(false);
    expect(isKnownNonCustomerSender("")).toBe(false);
    expect(isKnownNonCustomerSender("   ")).toBe(false);
  });
});
