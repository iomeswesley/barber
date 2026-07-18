import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./auth.js";

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
