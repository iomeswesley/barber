import { describe, it, expect } from "vitest";

// Achado em produção (2026-09-08): billing.routes.test.ts exercita de
// propósito 2 caminhos de erro (assinatura de webhook inválida, evento sem
// businessId) que chamam captureError — sem essa trava, cada `vitest run`
// disparava um alerta real no Sentry (o usuário recebeu por e-mail/push)
// pro comportamento esperado do teste, não um bug de verdade. NODE_ENV não
// serve de sinal aqui: o .env do projeto fixa NODE_ENV=development, não
// "test" — só process.env.VITEST (que o próprio Vitest define, não o .env)
// é confiável.
describe("errorReportingEnabled", () => {
  it("fica desligado durante os testes, mesmo com SENTRY_DSN configurado (evita alerta real disparado pelos próprios testes)", async () => {
    expect(process.env.SENTRY_DSN, "este teste só é significativo com SENTRY_DSN configurado no .env").toBeTruthy();
    expect(process.env.VITEST, "sinal que o errorReporting.ts usa pra se desligar").toBeTruthy();
    const { errorReportingEnabled } = await import("./errorReporting.js");
    expect(errorReportingEnabled).toBe(false);
  });
});
