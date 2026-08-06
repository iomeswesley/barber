import { describe, it, expect } from "vitest";

// Ver comentário em crypto.test.ts sobre preencher o env obrigatório antes
// do import. billing.service.ts importa src/lib/stripe.js (que instancia o
// SDK do Stripe só se STRIPE_SECRET_KEY estiver setada — sem ela, `stripe`
// fica null e mapStripeStatus continua testável isoladamente) e o
// prisma client (não abre conexão real na importação).
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.DIRECT_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.SESSION_SECRET ??= "test-session-secret";

const { mapStripeStatus } = await import("./billing.service.js");

// Cobre o mapeamento do status bruto do Stripe pro status interno de 4
// valores usado no resto do sistema (Subscription.status) — é a fronteira
// que o webhook do Stripe atravessa, então um mapeamento errado aqui
// silenciosamente destrava/trava acesso de uma barbearia inteira.
describe("mapStripeStatus", () => {
  it("mapeia trialing e active 1:1", () => {
    expect(mapStripeStatus("trialing")).toBe("trialing");
    expect(mapStripeStatus("active")).toBe("active");
  });

  it("mapeia past_due e unpaid pra past_due", () => {
    expect(mapStripeStatus("past_due")).toBe("past_due");
    expect(mapStripeStatus("unpaid")).toBe("past_due");
  });

  it("mapeia todo o resto (canceled, incomplete, incomplete_expired, paused) pra canceled", () => {
    expect(mapStripeStatus("canceled")).toBe("canceled");
    expect(mapStripeStatus("incomplete")).toBe("canceled");
    expect(mapStripeStatus("incomplete_expired")).toBe("canceled");
    expect(mapStripeStatus("paused")).toBe("canceled");
  });
});
