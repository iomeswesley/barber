import { describe, it, expect } from "vitest";

// Ver comentário em crypto.test.ts: preenche o env obrigatório antes do
// import (chatEngine importa vários repositórios que, transitivamente,
// importam @/config/env.js). ANTHROPIC_API_KEY fica de fora de propósito
// — chatEngine.ts instancia `new Anthropic()` no topo do módulo sem
// depender dela pra construir (só falharia numa chamada real de API),
// então testar as funções puras daqui não exige a chave.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.DIRECT_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.SESSION_SECRET ??= "test-session-secret";

const { formatPrice, describeClientPlanBenefit, normalizeWhatsappFormatting } = await import("./chatEngine.js");

describe("formatPrice", () => {
  it("converte centavos pra reais arredondados, sem casas decimais", () => {
    expect(formatPrice(9900)).toBe("R$ 99");
    expect(formatPrice(5000)).toBe("R$ 50");
  });

  it("arredonda em vez de truncar", () => {
    expect(formatPrice(9950)).toBe("R$ 100"); // 99.5 -> 100
    expect(formatPrice(9949)).toBe("R$ 99"); // 99.49 -> 99
  });

  it("lida com zero", () => {
    expect(formatPrice(0)).toBe("R$ 0");
  });
});

describe("describeClientPlanBenefit", () => {
  it("descreve unlimited_service com o nome do serviço", () => {
    expect(describeClientPlanBenefit({ benefitType: "unlimited_service", benefitValue: 1, serviceId: 1 }, "Corte Masculino")).toBe(
      "Acesso ilimitado a Corte Masculino"
    );
  });

  it("descreve unlimited_service sem nome de serviço com um fallback genérico", () => {
    expect(describeClientPlanBenefit({ benefitType: "unlimited_service", benefitValue: 1, serviceId: 1 })).toBe(
      "Acesso ilimitado a um serviço"
    );
  });

  it("descreve services_included com a quantidade mensal", () => {
    expect(describeClientPlanBenefit({ benefitType: "services_included", benefitValue: 2, serviceId: null }, "Corte Masculino")).toBe(
      "2x Corte Masculino incluído(s) por mês"
    );
  });

  it("descreve percent_discount com o percentual", () => {
    expect(describeClientPlanBenefit({ benefitType: "percent_discount", benefitValue: 20, serviceId: null })).toBe(
      "20% de desconto em qualquer serviço"
    );
  });

  it("retorna string vazia pra um benefitType desconhecido", () => {
    expect(describeClientPlanBenefit({ benefitType: "algo_novo", benefitValue: 1, serviceId: null })).toBe("");
  });
});

describe("normalizeWhatsappFormatting", () => {
  it("converte negrito markdown (**texto**) pro negrito de asterisco único do WhatsApp", () => {
    expect(normalizeWhatsappFormatting("Isso é **importante** pra você")).toBe("Isso é *importante* pra você");
  });

  it("converte múltiplas ocorrências no mesmo texto", () => {
    expect(normalizeWhatsappFormatting("**Primeiro** e **segundo**")).toBe("*Primeiro* e *segundo*");
  });

  it("não mexe em texto que já usa asterisco único", () => {
    expect(normalizeWhatsappFormatting("Já está *certo*")).toBe("Já está *certo*");
  });

  it("não mexe em texto sem nenhum negrito", () => {
    expect(normalizeWhatsappFormatting("Texto simples, sem formatação")).toBe("Texto simples, sem formatação");
  });
});
