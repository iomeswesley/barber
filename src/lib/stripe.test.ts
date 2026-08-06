import { describe, it, expect } from "vitest";

// Mesmo padrão dos outros testes puros do lib/: preenche só o que estiver
// faltando no ambiente antes de importar o módulo (que valida process.env
// no carregamento), pra o arquivo rodar isolado sem depender do .env.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.DIRECT_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.STRIPE_PRICE_STARTER = "price_starter_teste";
process.env.STRIPE_PRICE_PRO = "price_pro_teste";

const { priceIdForPlan, planForPriceId, PLAN_LIMITS, PLAN_PRICE_CENTS, PLAN_LABELS } = await import("./stripe.js");

describe("priceIdForPlan", () => {
  it("mapeia cada plano pro price configurado no ambiente", () => {
    expect(priceIdForPlan("starter")).toBe("price_starter_teste");
    expect(priceIdForPlan("pro")).toBe("price_pro_teste");
  });

  it("retorna undefined pra plano desconhecido", () => {
    expect(priceIdForPlan("enterprise")).toBeUndefined();
    expect(priceIdForPlan("")).toBeUndefined();
  });
});

describe("planForPriceId", () => {
  it("faz o caminho inverso de priceIdForPlan", () => {
    expect(planForPriceId("price_starter_teste")).toBe("starter");
    expect(planForPriceId("price_pro_teste")).toBe("pro");
  });

  // Um price desconhecido chega aqui pelo webhook customer.subscription.updated
  // (ex: price criado direto no Dashboard do Stripe sem configurar a env var).
  // Precisa devolver null e não um plano chutado — quem chama usa isso pra
  // decidir manter o plano que já estava gravado.
  it("retorna null pra price desconhecido, nulo ou vazio", () => {
    expect(planForPriceId("price_que_nao_existe")).toBeNull();
    expect(planForPriceId(null)).toBeNull();
    expect(planForPriceId(undefined)).toBeNull();
    expect(planForPriceId("")).toBeNull();
  });
});

// PLAN_LIMITS, PLAN_PRICE_CENTS e PLAN_LABELS são três tabelas mantidas em
// sincronia manual (ver comentário em lib/stripe.ts). Um plano novo adicionado
// em só uma delas quebra o cálculo de MRR ou a trava de limite em silêncio.
describe("tabelas de plano", () => {
  it("cobrem exatamente o mesmo conjunto de planos", () => {
    const limits = Object.keys(PLAN_LIMITS).sort();
    expect(Object.keys(PLAN_PRICE_CENTS).sort()).toEqual(limits);
    expect(Object.keys(PLAN_LABELS).sort()).toEqual(limits);
  });

  it("starter é limitado e mais barato que o pro, que é ilimitado", () => {
    expect(PLAN_LIMITS.starter).toBe(2);
    expect(PLAN_LIMITS.pro).toBeNull();
    expect(PLAN_PRICE_CENTS.starter).toBeLessThan(PLAN_PRICE_CENTS.pro);
  });
});
