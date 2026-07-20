import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, generateRandomPassword } from "./auth.js";

describe("hashPassword / verifyPassword", () => {
  it("aceita a senha correta", () => {
    const stored = hashPassword("minhaSenha123");
    expect(verifyPassword("minhaSenha123", stored)).toBe(true);
  });

  it("rejeita senha errada", () => {
    const stored = hashPassword("minhaSenha123");
    expect(verifyPassword("outraSenha", stored)).toBe(false);
  });

  it("nunca grava a senha em texto puro no hash armazenado", () => {
    const stored = hashPassword("minhaSenha123");
    expect(stored).not.toContain("minhaSenha123");
  });

  it("gera um salt diferente a cada chamada (dois hashes da mesma senha não batem)", () => {
    const a = hashPassword("mesmaSenha");
    const b = hashPassword("mesmaSenha");
    expect(a).not.toBe(b);
    expect(verifyPassword("mesmaSenha", a)).toBe(true);
    expect(verifyPassword("mesmaSenha", b)).toBe(true);
  });

  it("não lança erro com um hash armazenado malformado", () => {
    expect(verifyPassword("qualquer", "")).toBe(false);
    expect(verifyPassword("qualquer", "sem-dois-pontos")).toBe(false);
  });
});

describe("generateRandomPassword", () => {
  it("gera senha com o tamanho pedido", () => {
    expect(generateRandomPassword(12)).toHaveLength(12);
    expect(generateRandomPassword(20)).toHaveLength(20);
  });

  it("gera senhas diferentes a cada chamada", () => {
    const a = generateRandomPassword();
    const b = generateRandomPassword();
    expect(a).not.toBe(b);
  });

  it("não usa caracteres ambíguos (0/O, 1/l/I)", () => {
    const password = generateRandomPassword(200);
    expect(password).not.toMatch(/[0O1lI]/);
  });

  it("a senha gerada passa pelo mesmo hash/verify do resto do sistema", () => {
    const password = generateRandomPassword();
    const stored = hashPassword(password);
    expect(verifyPassword(password, stored)).toBe(true);
  });
});
