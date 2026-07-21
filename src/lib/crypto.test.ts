import { describe, it, expect } from "vitest";

// Setado antes do import de "./crypto.js" (que importa @/config/env.js e
// valida process.env — incluindo campos obrigatórios de outras features —
// no carregamento do módulo) pra este teste unitário não depender da carga
// assíncrona do .env ambiente já ter terminado quando o arquivo é rodado
// isoladamente (só preenche o que estiver faltando, nunca sobrescreve valor real).
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.DIRECT_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

const { encryptSecret, decryptSecret } = await import("./crypto.js");

describe("encryptSecret / decryptSecret", () => {
  it("faz round-trip do texto original", () => {
    const plain = "EAAG_access_token_de_teste_123";
    const encrypted = encryptSecret(plain);
    expect(encrypted).not.toBe(plain);
    expect(decryptSecret(encrypted)).toBe(plain);
  });

  it("gera saídas diferentes pro mesmo texto (IV aleatório)", () => {
    const plain = "mesmo-segredo";
    const a = encryptSecret(plain);
    const b = encryptSecret(plain);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(plain);
    expect(decryptSecret(b)).toBe(plain);
  });

  it("falha ao descriptografar com dado corrompido", () => {
    const encrypted = encryptSecret("segredo");
    const corrupted = encrypted.slice(0, -4) + "abcd";
    expect(() => decryptSecret(corrupted)).toThrow();
  });
});
