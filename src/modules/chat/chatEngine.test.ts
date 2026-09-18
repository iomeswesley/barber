import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Anthropic from "@anthropic-ai/sdk";

// Ver comentário em crypto.test.ts: preenche o env obrigatório antes do
// import (chatEngine importa vários repositórios que, transitivamente,
// importam @/config/env.js). ANTHROPIC_API_KEY fica de fora de propósito
// — chatEngine.ts instancia `new Anthropic()` no topo do módulo sem
// depender dela pra construir (só falharia numa chamada real de API),
// então testar as funções puras daqui não exige a chave.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.DIRECT_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.SESSION_SECRET ??= "test-session-secret";

const { formatPrice, describeClientPlanBenefit, normalizeWhatsappFormatting, pruneStaleAppointmentHistory, isAnthropicAuthOrCreditError, buildDynamicContext } =
  await import("./chatEngine.js");

// Achado em produção (14/09): mesmo com "hoje é" correto no prompt, o
// modelo às vezes erra a CONTA de "amanhã" (chamou verificar_horarios_
// disponiveis com a data de HOJE quando o cliente pediu "amanhã") — erro
// residual de aritmética, não bug de dado de entrada. Pedido do usuário no
// mesmo dia: cobrir também dia da semana solto ("quinta", "sexta"), não só
// "amanhã". buildDynamicContext agora entrega os próximos 8 dias (hoje +7)
// já calculados no texto do prompt, tirando a conta de cabeça do modelo.
describe("buildDynamicContext", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("informa 'amanhã' já calculado, não só 'hoje', pra tirar a conta de cabeça do modelo", () => {
    vi.setSystemTime(new Date("2026-09-14T17:49:00-03:00")); // segunda-feira
    const text = buildDynamicContext({ existingClient: null, pushName: "Wesley" }, null, []);
    expect(text).toContain("Hoje é segunda-feira, 2026-09-14");
    expect(text).toContain("segunda-feira: 2026-09-14 (hoje)");
    expect(text).toContain("terça-feira: 2026-09-15 (amanhã)");
  });

  it("com locale fr entrega a tabela de dias em francês (negócio em Luxemburgo)", () => {
    vi.setSystemTime(new Date("2026-09-14T17:49:00-03:00")); // segunda-feira
    const text = buildDynamicContext({ existingClient: null, pushName: "Wesley" }, null, [], "fr");
    expect(text).toContain("lundi: 2026-09-14 (hoje)");
    expect(text).toContain("mardi: 2026-09-15 (amanhã)");
  });

  it("lista os próximos 8 dias (hoje + 7), cobrindo qualquer dia da semana solto ('quinta', 'sexta')", () => {
    vi.setSystemTime(new Date("2026-09-14T17:49:00-03:00")); // segunda-feira
    const text = buildDynamicContext({ existingClient: null, pushName: "Wesley" }, null, []);
    expect(text).toContain("quinta-feira: 2026-09-17");
    expect(text).toContain("sexta-feira: 2026-09-18");
    expect(text).toContain("segunda-feira: 2026-09-21"); // a semana seguinte, sem marca (hoje)/(amanhã)
  });

  it("calcula certo na virada de mês", () => {
    vi.setSystemTime(new Date("2026-09-30T10:00:00-03:00"));
    const text = buildDynamicContext({ existingClient: null, pushName: "Wesley" }, null, []);
    expect(text).toContain("Hoje é quarta-feira, 2026-09-30");
    expect(text).toContain("quarta-feira: 2026-09-30 (hoje)");
    expect(text).toContain("quinta-feira: 2026-10-01 (amanhã)");
  });
});

describe("formatPrice em outra moeda/locale", () => {
  it("EUR em francês não arredonda centavos", () => {
    expect(formatPrice(1550, "EUR", "fr")).toContain("15,50");
    expect(formatPrice(1500, "EUR", "fr")).not.toMatch(/,\d{2}/);
  });
});

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

  // Segunda ocorrência real do bug (2026-09-06): o pedido de avaliação
  // pendente é legítimo e cita a data em prosa, sem link — a IA alucinou
  // "você já tem um agendamento" no mesmo texto, e essa frase (sem .ics)
  // virou o novo ponto de ancoragem no turno seguinte.
  it("remove texto livre que cita só a data (DD/MM) do agendamento vencido, mesmo sem o link .ics", () => {
    const messages: Anthropic.MessageParam[] = [
      ...toolExchange(
        "t1",
        "criar_agendamento",
        { data: "2026-09-05", horario: "11:00", servico_id: 2, barbeiro_id: 2, nome_cliente: "Wesley" },
        { agendamento_id: 2288, confirmado: true, resumo: "..." }
      ),
      { role: "user", content: "Tem cabelo pra amanhã?" },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Como foi seu último atendimento (dia 05/09)? E você já tem um agendamento pra amanhã às 11:00 com o Diego.",
          },
        ],
      },
    ];
    const pruned = pruneStaleAppointmentHistory(messages, TODAY);
    expect(pruned).toEqual([{ role: "user", content: "Tem cabelo pra amanhã?" }]);
  });

  it("não remove texto que menciona uma data futura só porque contém dígitos parecidos", () => {
    const messages: Anthropic.MessageParam[] = [
      ...toolExchange(
        "t1",
        "criar_agendamento",
        { data: "2026-09-05", horario: "11:00", servico_id: 2, barbeiro_id: 2, nome_cliente: "Wesley" },
        { agendamento_id: 2288, confirmado: true, resumo: "..." }
      ),
      { role: "assistant", content: [{ type: "text", text: "Show, dia 10/09 o Diego tem horário às 14h!" }] },
    ];
    const pruned = pruneStaleAppointmentHistory(messages, TODAY);
    expect(pruned).toEqual([{ role: "assistant", content: [{ type: "text", text: "Show, dia 10/09 o Diego tem horário às 14h!" }] }]);
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

  // Bug real achado rodando uma conversa de múltiplos turnos de verdade
  // (2026-09-06): nos dois "early return" (sem nada pra podar), a função
  // devolvia a MESMA referência do array de entrada. O chamador
  // (sendMessage) trata o retorno daqui (apiMessages) e session.messages
  // como duas variáveis independentes — um session.messages.push(...)
  // acabava mutando as duas ao mesmo tempo, e o apiMessages = [...apiMessages,
  // novoItem] do chamador duplicava a mensagem que aquele push já tinha
  // acrescentado. A Anthropic rejeitava com "tool_use ids must be unique"
  // assim que a conversa passava do primeiro turno. Nunca deve devolver a
  // mesma referência do array recebido, em nenhum caso.
  it("nunca devolve a mesma referência do array recebido, mesmo sem nada pra podar", () => {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: "Oi" }];
    expect(pruneStaleAppointmentHistory(messages, TODAY)).not.toBe(messages);
  });

  // Bug real em produção (13/09, sessão de teste 1:554797760610): cliente
  // pediu "Carlos amanhã 17h", o bot chamou verificar_horarios_disponiveis,
  // achou vaga e perguntou "confirma?" — mas o cliente nunca respondeu "sim"
  // (nem criar_agendamento chegou a ser chamado). Dias depois, só mandando
  // "Olá" solto, o bot continuava reoferecendo esse MESMO horário como se
  // ainda fosse válido, porque só agendamento JÁ CONFIRMADO com data velha
  // era podado — uma checagem de disponibilidade pendente, nunca confirmada,
  // não tinha poda nenhuma e ficava ancorando a conversa pra sempre.
  it("remove verificar_horarios_disponiveis com data vencida, mesmo sem ter virado agendamento", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "Carlos amanhã 17h" },
      ...toolExchange(
        "t1",
        "verificar_horarios_disponiveis",
        { data: "2026-09-05", servico_id: 2, barbeiro_id: 3 },
        { data: "2026-09-05", horarios_disponiveis: ["17:00"] }
      ),
      {
        role: "assistant",
        content: [{ type: "text", text: "17:00 está disponível! Corte Masculino com Carlos, amanhã (05/09). Confirma?" }],
      },
      { role: "user", content: "Olá" },
    ];
    const pruned = pruneStaleAppointmentHistory(messages, TODAY);
    expect(pruned).toEqual([
      { role: "user", content: "Carlos amanhã 17h" },
      { role: "user", content: "Olá" },
    ]);
  });

  it("remove buscar_proximo_horario_disponivel cuja data_inicial já passou", () => {
    const messages = toolExchange(
      "t1",
      "buscar_proximo_horario_disponivel",
      { data_inicial: "2026-09-05", servico_id: 2, barbeiro_id: 3 },
      { encontrado: true, data: "2026-09-05" }
    );
    expect(pruneStaleAppointmentHistory(messages, TODAY)).toEqual([]);
  });

  it("NÃO remove verificar_horarios_disponiveis cuja data ainda não chegou", () => {
    const messages = toolExchange(
      "t1",
      "verificar_horarios_disponiveis",
      { data: "2026-09-07", servico_id: 2, barbeiro_id: 3 },
      { data: "2026-09-07", horarios_disponiveis: ["17:00"] }
    );
    expect(pruneStaleAppointmentHistory(messages, TODAY)).toEqual(messages);
  });

  // Bateria de cenários adicionais (13/09) — mesmo espírito das baterias já
  // usadas nos bugs de data anteriores: um caso único que passa não prova
  // nada sobre os outros formatos que a mesma conversa real pode assumir.
  it("remove DUAS ofertas vencidas empilhadas (datas diferentes, nenhuma confirmada)", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "Quero cabelo amanhã" },
      ...toolExchange(
        "t1",
        "verificar_horarios_disponiveis",
        { data: "2026-09-04", servico_id: 2, barbeiro_id: 3 },
        { data: "2026-09-04", horarios_disponiveis: [] }
      ),
      { role: "assistant", content: [{ type: "text", text: "Sem vaga dia 04/09, que tal 05/09?" }] },
      { role: "user", content: "Pode ser" },
      ...toolExchange(
        "t2",
        "verificar_horarios_disponiveis",
        { data: "2026-09-05", servico_id: 2, barbeiro_id: 3 },
        { data: "2026-09-05", horarios_disponiveis: ["17:00"] }
      ),
      { role: "assistant", content: [{ type: "text", text: "17:00 disponível dia 05/09! Confirma?" }] },
      { role: "user", content: "Olá" },
    ];
    const pruned = pruneStaleAppointmentHistory(messages, TODAY);
    expect(pruned).toEqual([
      { role: "user", content: "Quero cabelo amanhã" },
      { role: "user", content: "Pode ser" },
      { role: "user", content: "Olá" },
    ]);
  });

  it("remove uma checagem pendente vencida E um agendamento confirmado vencido no mesmo histórico, independentemente", () => {
    const messages: Anthropic.MessageParam[] = [
      ...toolExchange(
        "t1",
        "criar_agendamento",
        { data: "2026-09-01", horario: "10:00", servico_id: 2, barbeiro_id: 2, nome_cliente: "Wesley" },
        { agendamento_id: 100, confirmado: true, resumo: "..." }
      ),
      { role: "assistant", content: [{ type: "text", text: "Prontinho! Corte confirmado dia 01/09 às 10h." }] },
      { role: "user", content: "Quero barba também" },
      ...toolExchange(
        "t2",
        "verificar_horarios_disponiveis",
        { data: "2026-09-05", servico_id: 3, barbeiro_id: 2 },
        { data: "2026-09-05", horarios_disponiveis: ["09:00"] }
      ),
      { role: "assistant", content: [{ type: "text", text: "09:00 disponível dia 05/09 pra barba! Confirma?" }] },
      { role: "user", content: "Olá" },
    ];
    const pruned = pruneStaleAppointmentHistory(messages, TODAY);
    expect(pruned).toEqual([
      { role: "user", content: "Quero barba também" },
      { role: "user", content: "Olá" },
    ]);
  });

  it("mantém uma checagem vencida antiga removida mas preserva uma checagem nova (fresca) do mesmo serviço logo depois", () => {
    const messages: Anthropic.MessageParam[] = [
      ...toolExchange(
        "t1",
        "verificar_horarios_disponiveis",
        { data: "2026-09-01", servico_id: 2, barbeiro_id: 3 },
        { data: "2026-09-01", horarios_disponiveis: ["17:00"] }
      ),
      { role: "assistant", content: [{ type: "text", text: "17:00 disponível dia 01/09! Confirma?" }] },
      { role: "user", content: "Não pude, e amanhã?" },
      ...toolExchange(
        "t2",
        "verificar_horarios_disponiveis",
        { data: "2026-09-07", servico_id: 2, barbeiro_id: 3 },
        { data: "2026-09-07", horarios_disponiveis: ["17:00"] }
      ),
      { role: "assistant", content: [{ type: "text", text: "17:00 disponível dia 07/09! Confirma?" }] },
    ];
    const pruned = pruneStaleAppointmentHistory(messages, TODAY);
    expect(pruned).toEqual([
      { role: "user", content: "Não pude, e amanhã?" },
      ...toolExchange(
        "t2",
        "verificar_horarios_disponiveis",
        { data: "2026-09-07", servico_id: 2, barbeiro_id: 3 },
        { data: "2026-09-07", horarios_disponiveis: ["17:00"] }
      ),
      { role: "assistant", content: [{ type: "text", text: "17:00 disponível dia 07/09! Confirma?" }] },
    ]);
  });

  // Reprodução mais fiel da sessão real de produção (1:554797760610, 13/09):
  // oferta pendente + vários "Olá" soltos do cliente sem responder — a poda
  // precisa sobreviver a essa sequência longa e ainda assim limpar tudo.
  it("reproduz a sessão real: oferta pendente + vários 'Olá' soltos do cliente, tudo depois é removido", () => {
    const staleOffer = toolExchange(
      "t1",
      "verificar_horarios_disponiveis",
      { data: "2026-09-05", servico_id: 2, barbeiro_id: 3 },
      { data: "2026-09-05", horarios_disponiveis: ["17:00"] }
    );
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "Carlos amanha 17h" },
      ...staleOffer,
      { role: "assistant", content: [{ type: "text", text: "17:00 está disponível! Confirmando: Corte Masculino, Carlos, 05/09 às 17:00. Confirma?" }] },
      { role: "user", content: "Olá" },
      { role: "user", content: "Olá" },
      { role: "user", content: "Olá" },
      {
        role: "assistant",
        content: [{ type: "text", text: "Ainda temos aquele agendamento de Corte Masculino com o Carlos amanhã (05/09) às 17:00 — só falta confirmar." }],
      },
      { role: "user", content: "Olá" },
    ];
    const pruned = pruneStaleAppointmentHistory(messages, TODAY);
    expect(pruned).toEqual([
      { role: "user", content: "Carlos amanha 17h" },
      { role: "user", content: "Olá" },
      { role: "user", content: "Olá" },
      { role: "user", content: "Olá" },
      { role: "user", content: "Olá" },
    ]);
  });

  // BUG CRÍTICO real em produção (13/09), achado imediatamente depois de
  // subir a extensão acima: com effort medium/high o modelo manda um bloco
  // "thinking" (mesmo vazio) ANTES do tool_use na mesma mensagem. O filtro
  // original checava `content.every(bloco é tool_use/tool_result stale)` —
  // como "thinking" não é nem um nem outro, o `every()` dava falso pra
  // mensagem [thinking, tool_use], que ficava de fora da poda; mas a
  // mensagem tool_result correspondente (sem thinking) BATIA e era
  // removida — descasando tool_use de tool_result e derrubando a chamada
  // real à Anthropic com 400 ("tool_use ids were found without tool_result
  // blocks"). Sessão real de produção travada até esse fix.
  it("poda corretamente uma troca com bloco 'thinking' antes do tool_use (não deixa tool_use órfão)", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "Quero cabelo amanhã" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "", signature: "abc" } as any,
          { type: "tool_use", id: "t1", name: "verificar_horarios_disponiveis", input: { data: "2026-09-05", servico_id: 2, barbeiro_id: 3 } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: JSON.stringify({ data: "2026-09-05", horarios_disponiveis: ["17:00"] }) }] },
      { role: "assistant", content: [{ type: "text", text: "17:00 disponível dia 05/09! Confirma?" }] },
      { role: "user", content: "Olá" },
    ];
    const pruned = pruneStaleAppointmentHistory(messages, TODAY);
    expect(pruned).toEqual([
      { role: "user", content: "Quero cabelo amanhã" },
      { role: "user", content: "Olá" },
    ]);
    // Garantia estrutural: nenhum tool_use sobrevivente sem o tool_result
    // imediatamente depois — é exatamente essa invariante que a Anthropic
    // exige e cujo rompimento derrubou a sessão real.
    pruned.forEach((m, i) => {
      if (!Array.isArray(m.content)) return;
      for (const block of m.content) {
        if (block.type !== "tool_use") continue;
        const next = pruned[i + 1];
        const hasResult = Array.isArray(next?.content) && (next!.content as any[]).some((b) => b.type === "tool_result" && b.tool_use_id === block.id);
        expect(hasResult).toBe(true);
      }
    });
  });

  it("mantém intacta uma troca com 'thinking' + tool_use cuja data ainda não chegou", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "", signature: "abc" } as any,
          { type: "tool_use", id: "t1", name: "verificar_horarios_disponiveis", input: { data: "2026-09-07", servico_id: 2, barbeiro_id: 3 } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: JSON.stringify({ data: "2026-09-07", horarios_disponiveis: ["17:00"] }) }] },
    ];
    expect(pruneStaleAppointmentHistory(messages, TODAY)).toEqual(messages);
  });

  // BUG real em produção (14/09): a IA calculou "amanhã" errado (usou a
  // data de HOJE) antes de um fix no prompt, disse isso em texto livre —
  // sem nenhum tool_use por trás (o tool_use real foi com a data de hoje,
  // que não é "stale" por definição de data passada) — e continuou
  // REPETINDO essa mesma frase errada em turnos seguintes, mesmo já com o
  // prompt corrigido dizendo o "amanhã" certo. Diferente dos outros casos
  // desta suíte, esse texto nunca teve um tool_use vencido associado.
  it("remove texto livre com 'amanhã (DD/MM)' que não bate com o amanhã de verdade, mesmo sem tool_use nenhum por trás", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "O que tem pra amanhã" },
      { role: "assistant", content: [{ type: "text", text: "Pro Corte Masculino com o Carlos amanhã (06/09), os horários livres são 16:00 e 16:30." }] },
      { role: "user", content: "Olá" },
    ];
    // TODAY = "2026-09-06" (domingo) — amanhã de verdade é 07/09, não 06/09.
    const pruned = pruneStaleAppointmentHistory(messages, TODAY);
    expect(pruned).toEqual([
      { role: "user", content: "O que tem pra amanhã" },
      { role: "user", content: "Olá" },
    ]);
  });

  it("NÃO remove texto livre com 'amanhã (DD/MM)' quando a data bate com o amanhã de verdade", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "assistant", content: [{ type: "text", text: "Pro Corte Masculino amanhã (07/09), tenho 16:00 e 16:30." }] },
    ];
    expect(pruneStaleAppointmentHistory(messages, TODAY)).toEqual(messages);
  });

  it("não mexe em texto que não menciona 'amanhã' nenhum", () => {
    const messages: Anthropic.MessageParam[] = [{ role: "assistant", content: [{ type: "text", text: "Corte Masculino custa R$40." }] }];
    expect(pruneStaleAppointmentHistory(messages, TODAY)).toEqual(messages);
  });

  it("reproduz o caso real: 4 respostas repetindo 'amanhã (DD/MM)' errado ao longo de vários turnos, todas removidas", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "Carlos amanha 17h" },
      { role: "assistant", content: [{ type: "text", text: "Vi aqui que às 17h o Carlos não tem horário livre amanhã (06/09) pro Corte Masculino." }] },
      { role: "user", content: "Olá" },
      { role: "assistant", content: [{ type: "text", text: "Vamos lá: pro Corte Masculino com o Carlos amanhã (06/09), tenho 16:00, 16:30 ou 18:30." }] },
      { role: "user", content: "Olá" },
      { role: "assistant", content: [{ type: "text", text: "Ainda sobre o corte com o Carlos amanhã (06/09) — tenho 16:00, 16:30 ou 18:30." }] },
      { role: "user", content: "O que tem pra amanhã" },
      { role: "assistant", content: [{ type: "text", text: "Pro Corte Masculino com o Carlos amanhã (06/09), os horários livres são 16:00, 16:30 ou 18:30." }] },
    ];
    const pruned = pruneStaleAppointmentHistory(messages, TODAY);
    expect(pruned).toEqual([
      { role: "user", content: "Carlos amanha 17h" },
      { role: "user", content: "Olá" },
      { role: "user", content: "Olá" },
      { role: "user", content: "O que tem pra amanhã" },
    ]);
  });
});

// Achado em produção (2026-09-07): créditos da Anthropic zeraram e o bot
// ficou fora do ar sem ninguém perceber — ver alertAnthropicFailureIfNeeded
// (chatEngine.ts) e alertPlatformOperator (lib/alerts.ts).
describe("isAnthropicAuthOrCreditError", () => {
  it("reconhece erro de autenticação (401)", () => {
    const err = new Anthropic.AuthenticationError(401, { message: "invalid x-api-key" }, "invalid x-api-key", new Headers());
    expect(isAnthropicAuthOrCreditError(err)).toBe(true);
  });

  it("reconhece erro de permissão (403)", () => {
    const err = new Anthropic.PermissionDeniedError(403, { message: "forbidden" }, "forbidden", new Headers());
    expect(isAnthropicAuthOrCreditError(err)).toBe(true);
  });

  // O erro real de crédito zerado (visto em produção) é um 400 comum, sem
  // classe própria no SDK — só a mensagem denuncia.
  it("reconhece 'credit balance too low' embutido na mensagem de um erro genérico", () => {
    expect(isAnthropicAuthOrCreditError(new Error("400 Your credit balance is too low to access the Anthropic API."))).toBe(true);
  });

  it("NÃO reconhece um erro de negócio comum (ex: rate limit) como problema de créditos/autenticação", () => {
    expect(isAnthropicAuthOrCreditError(new Error("429 Rate limit exceeded"))).toBe(false);
  });

  it("volta false pra algo que não é um Error", () => {
    expect(isAnthropicAuthOrCreditError("string qualquer")).toBe(false);
    expect(isAnthropicAuthOrCreditError(null)).toBe(false);
  });
});
