import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

// Ver comentário em crypto.test.ts: preenche o env obrigatório antes do
// import (chatEngine importa vários repositórios que, transitivamente,
// importam @/config/env.js). ANTHROPIC_API_KEY fica de fora de propósito
// — chatEngine.ts instancia `new Anthropic()` no topo do módulo sem
// depender dela pra construir (só falharia numa chamada real de API),
// então testar as funções puras daqui não exige a chave.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.DIRECT_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.SESSION_SECRET ??= "test-session-secret";

const { formatPrice, describeClientPlanBenefit, normalizeWhatsappFormatting, pruneStaleAppointmentHistory } = await import("./chatEngine.js");

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

// Achado em produção (2026-09-06): mesmo com "hoje é" e a lista de
// agendamentos futuros corretos no prompt, a IA continuava afirmando que um
// agendamento antigo (já passado) ainda estava de pé — porque o tool_result
// antigo ("confirmado":true) e o texto de confirmação continuavam visíveis
// no histórico da conversa. Confirmado por teste isolado (várias tentativas,
// só parou de acontecer removendo essas trocas do que é mandado pra API.
describe("pruneStaleAppointmentHistory", () => {
  const TODAY = "2026-09-06";

  function toolExchange(toolUseId: string, name: string, input: object, resultContent: object): Anthropic.MessageParam[] {
    return [
      { role: "assistant", content: [{ type: "tool_use", id: toolUseId, name, input }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: JSON.stringify(resultContent) }] },
    ];
  }

  it("remove o par tool_use/tool_result de criar_agendamento cuja data já passou", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "Quero agendar amanhã" },
      ...toolExchange(
        "t1",
        "criar_agendamento",
        { data: "2026-09-05", horario: "11:00", servico_id: 2, barbeiro_id: 2, nome_cliente: "Wesley" },
        { agendamento_id: 2288, confirmado: true, resumo: "Corte Masculino com Diego em 2026-09-05 às 11:00" }
      ),
    ];
    const pruned = pruneStaleAppointmentHistory(messages, TODAY);
    expect(pruned).toEqual([{ role: "user", content: "Quero agendar amanhã" }]);
  });

  it("remove também a mensagem de texto livre que cita o link .ics do agendamento removido", () => {
    const messages: Anthropic.MessageParam[] = [
      ...toolExchange(
        "t1",
        "criar_agendamento",
        { data: "2026-09-05", horario: "11:00", servico_id: 2, barbeiro_id: 2, nome_cliente: "Wesley" },
        { agendamento_id: 2288, confirmado: true, resumo: "..." }
      ),
      {
        role: "assistant",
        content: [{ type: "text", text: "Prontinho! Adicione: https://agenda-barb.vercel.app/api/appointments/2288/ics?phone=123" }],
      },
      { role: "user", content: "Manda dnv a confirmação" },
      {
        role: "assistant",
        content: [{ type: "text", text: "Aqui está: https://agenda-barb.vercel.app/api/appointments/2288/ics?phone=123" }],
      },
    ];
    const pruned = pruneStaleAppointmentHistory(messages, TODAY);
    expect(pruned).toEqual([{ role: "user", content: "Manda dnv a confirmação" }]);
  });

  it("NÃO remove um agendamento futuro (data ainda não chegou)", () => {
    const messages = toolExchange(
      "t1",
      "criar_agendamento",
      { data: "2026-09-07", horario: "11:00", servico_id: 2, barbeiro_id: 2, nome_cliente: "Wesley" },
      { agendamento_id: 2300, confirmado: true, resumo: "..." }
    );
    expect(pruneStaleAppointmentHistory(messages, TODAY)).toEqual(messages);
  });

  it("NÃO mexe no histórico se não houver nenhuma troca de agendamento", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "Oi" },
      { role: "assistant", content: [{ type: "text", text: "Olá! Como posso ajudar?" }] },
    ];
    expect(pruneStaleAppointmentHistory(messages, TODAY)).toEqual(messages);
  });
});
