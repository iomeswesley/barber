import Anthropic from "@anthropic-ai/sdk";
import { getBarbershop } from "@/modules/barbershops/barbershops.repository.js";
import { getServices } from "@/modules/services/services.repository.js";
import { getBarbers } from "@/modules/barbers/barbers.repository.js";
import { getClientByPhone, findOrCreateClient, markMarketingOptIn } from "@/modules/clients/clients.repository.js";
import { getAppointmentById } from "@/modules/appointments/appointments.repository.js";
import {
  getAvailableSlots,
  findNextAvailableDay,
  createAppointment,
  getAppointmentsByClientPhone,
  cancelAppointment,
  rescheduleAppointment,
  getUnreviewedCompletedAppointment,
} from "@/modules/appointments/appointments.service.js";
import { markReviewPrompted } from "@/modules/appointments/appointments.repository.js";
import { createReview } from "@/modules/reviews/reviews.repository.js";
import { createEscalation } from "@/modules/escalations/escalations.repository.js";
import { notifyNewAppointment, notifyEscalation } from "@/modules/push/push.service.js";
import { prisma } from "@/lib/prisma.js";
import { env } from "@/config/env.js";
import type { Barbershop, Prisma } from "@prisma/client";

const client = new Anthropic();
const MODEL = "claude-sonnet-5";
const MAX_ITERATIONS = 8;

interface ChatSession {
  barbershopId: number;
  messages: Anthropic.MessageParam[];
}

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

function formatPrice(cents: number): string {
  return `R$ ${Math.round(cents / 100)}`;
}

// O telefone vai como query param e a rota confere contra o dono do
// agendamento — sem isso, o link (que sai sem login nenhum, direto no
// WhatsApp) deixaria qualquer pessoa baixar o .ics de qualquer agendamento
// só incrementando o ID na URL.
function icsUrl(appointmentId: number, phone: string): string {
  return `${env.PUBLIC_BASE_URL || ""}/api/appointments/${appointmentId}/ics?phone=${encodeURIComponent(phone)}`;
}

// Rede de segurança: mesmo instruído a usar negrito de UM asterisco (sintaxe
// do WhatsApp), o modelo às vezes escorrega pro **negrito** padrão de
// Markdown — que o WhatsApp não entende e mostra os asteriscos soltos.
function normalizeWhatsappFormatting(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "*$1*");
}

function buildStableSystemPrompt(barbershop: Barbershop & { opensAt?: string; closesAt?: string }): string {
  return `Você é o assistente virtual de agendamentos da "${barbershop.name}", conversando por WhatsApp com clientes.

Endereço: ${barbershop.address || "não informado"}.
O telefone deste cliente já é conhecido automaticamente pelo WhatsApp (é o próprio remetente da conversa) — NUNCA peça o telefone, o sistema já injeta isso sozinho ao agendar, cancelar ou reagendar.

Seu objetivo é conduzir uma conversa natural e breve. Você pode: agendar um novo horário, cancelar ou reagendar um horário já existente, e coletar avaliações. Siga este fluxo para agendar:
1. Descubra qual serviço o cliente deseja (use a ferramenta listar_servicos se precisar mostrar as opções com preços e duração).
2. Pergunte com qual barbeiro ele gostaria de ser atendido (use listar_barbeiros para mostrar os nomes). Se ele não tiver preferência, escolha um barbeiro e verifique a disponibilidade, ou ofereça verificar todos.
3. Pergunte o dia desejado e use verificar_horarios_disponiveis para checar horários livres. Converta datas relativas ("amanhã", "sexta-feira que vem") para o formato YYYY-MM-DD com base na data de hoje informada no contexto abaixo. Sugira 3 a 5 horários disponíveis. Se o cliente for vago sobre o dia ("qualquer dia", "não tenho preferência", "o mais rápido possível"), NÃO fique perguntando de novo — use a ferramenta buscar_proximo_horario_disponivel a partir de hoje e já sugira os horários encontrados.
4. Quando o cliente escolher um horário, confirme os detalhes (serviço, barbeiro, data, horário e preço) — NÃO peça nome nem telefone de novo, você já sabe quem é o cliente (veja o contexto abaixo). Inclua também, de forma breve e natural (não como um termo legal formal), que ao confirmar o cliente concorda em receber lembretes e mensagens futuras da barbearia por aqui — ex: "Confirma? (ao confirmar, você topa receber lembretes e novidades nossas por aqui 😉)".
5. Só depois de confirmação explícita do cliente, use a ferramenta criar_agendamento para gravar o agendamento.
6. Depois de agendar com sucesso, informe o cliente que o agendamento foi confirmado e inclua na sua resposta, de forma clara, o link para adicionar ao calendário que virá no resultado da ferramenta (campo ics_url) — escreva a URL completa como veio, sem alterar.

Para cancelar ou reagendar:
- Se o cliente quiser ver, cancelar ou remarcar um agendamento, use listar_meus_agendamentos primeiro para saber quais existem e pegar o ID correto — nunca invente um ID.
- Confirme com o cliente qual agendamento e a ação (cancelar ou o novo horário) antes de executar cancelar_agendamento ou reagendar_agendamento.
- Para reagendar, cheque a nova disponibilidade com verificar_horarios_disponiveis antes de confirmar com o cliente.

Quando encaminhar para atendimento humano:
- Se o cliente relatar uma reclamação séria (ex: cobrança indevida, atendimento muito ruim, algo que exige uma decisão que você não pode tomar) ou uma emergência, NÃO tente resolver sozinho nem insista no fluxo de agendamento. Use a ferramenta escalar_atendimento_humano com um resumo curto do motivo, e informe o cliente de forma empática que a equipe vai entrar em contato diretamente. Só volte ao agendamento se o próprio cliente pedir.

Regras de estilo:
- Seja cordial, direto e breve, como uma conversa real de WhatsApp — sem parágrafos longos.
- Não invente serviços, barbeiros, preços, horários ou IDs de agendamento: sempre use as ferramentas para obter dados reais.
- Se o cliente pedir algo fora do escopo que não seja uma reclamação séria ou emergência (ex: pergunta geral), responda educadamente e redirecione para o agendamento.
- Formatação: isto é WhatsApp, não Markdown. Para negrito use UM asterisco de cada lado (*assim*), NUNCA dois (**assim** está errado e aparece quebrado pro cliente). Para itálico use underline (_assim_). Não use markdown de título (#), link ([]()) nem tabelas.`;
}

interface Identity {
  existingClient: { name: string } | null;
  pushName?: string | null;
}

function buildDynamicContext(identity: Identity, pendingReview: Awaited<ReturnType<typeof getUnreviewedCompletedAppointment>>): string {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const weekday = WEEKDAYS[now.getDay()];

  let identityBlock: string;
  if (identity.existingClient) {
    identityBlock = `- Este é um cliente que já agendou antes. O nome dele já está registrado como "${identity.existingClient.name}". Use esse nome diretamente, sem perguntar de novo — só confirme se ele mesmo disser que o nome está errado.`;
  } else if (identity.pushName) {
    identityBlock = `- Cliente novo. O nome de perfil do WhatsApp dele é "${identity.pushName}". Use esse nome diretamente ao criar o agendamento, sem precisar perguntar — só ajuste se ele mencionar um nome diferente durante a conversa.`;
  } else {
    identityBlock = `- Cliente novo e sem nome de perfil disponível. Pergunte o nome dele em algum momento natural da conversa, antes de agendar.`;
  }

  const reviewBlock = pendingReview
    ? `\n\nATENÇÃO — pedido de avaliação pendente: este cliente teve um atendimento (ID ${pendingReview.id}: ${pendingReview.serviceName} com ${pendingReview.barberName} em ${pendingReview.date}) que ainda não foi avaliado. Antes de tratar do assunto principal da mensagem dele (ou logo depois, o que soar mais natural), pergunte de forma breve e simpática como foi esse atendimento e peça uma nota de 1 a 5 (e um comentário curto, opcional). Se ele responder com uma nota, use a ferramenta registrar_avaliacao com agendamento_id = ${pendingReview.id} (esse é o ID real — não peça isso ao cliente, você já sabe). Se ele ignorar ou disser que não quer avaliar, não insista — siga com o resto da conversa normalmente.`
    : "";

  return `Contexto atual:
- Hoje é ${weekday}, ${todayIso} (formato YYYY-MM-DD).
${identityBlock}${reviewBlock}`;
}

const tools: Anthropic.Tool[] = [
  {
    name: "listar_servicos",
    description: "Lista os serviços oferecidos pela barbearia, com nome, preço e duração em minutos.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "listar_barbeiros",
    description: "Lista os barbeiros que atendem nesta barbearia.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "verificar_horarios_disponiveis",
    description: "Verifica os horários livres de um barbeiro para um serviço em uma data específica. Use depois que o cliente escolher serviço, barbeiro e dia.",
    input_schema: {
      type: "object",
      properties: {
        barbeiro_id: { type: "integer", description: "ID do barbeiro (obtido de listar_barbeiros)" },
        servico_id: { type: "integer", description: "ID do serviço (obtido de listar_servicos)" },
        data: { type: "string", description: "Data no formato YYYY-MM-DD" },
      },
      required: ["barbeiro_id", "servico_id", "data"],
    },
  },
  {
    name: "buscar_proximo_horario_disponivel",
    description: "Varre os próximos dias a partir de uma data (pulando dias em que a barbearia está fechada) e retorna o primeiro dia com horários livres para o barbeiro e serviço escolhidos. Use quando o cliente não tiver preferência de dia, em vez de perguntar 'qual dia?' de novo.",
    input_schema: {
      type: "object",
      properties: {
        barbeiro_id: { type: "integer", description: "ID do barbeiro (obtido de listar_barbeiros)" },
        servico_id: { type: "integer", description: "ID do serviço (obtido de listar_servicos)" },
        data_inicial: { type: "string", description: "A partir de qual data buscar, formato YYYY-MM-DD (normalmente hoje)" },
      },
      required: ["barbeiro_id", "servico_id", "data_inicial"],
    },
  },
  {
    name: "escalar_atendimento_humano",
    description: "Sinaliza para a equipe da barbearia que este cliente precisa de atendimento humano (reclamação séria, emergência, ou algo que você não pode resolver). Use no lugar de tentar resolver sozinho ou insistir no agendamento.",
    input_schema: {
      type: "object",
      properties: { motivo: { type: "string", description: "Resumo curto do motivo da escalada, para a equipe entender rapidamente o contexto" } },
      required: ["motivo"],
    },
  },
  {
    name: "criar_agendamento",
    description: "Grava o agendamento na base de dados. O telefone do cliente já é conhecido automaticamente (não faz parte desta ferramenta). Só chame depois que o cliente confirmar explicitamente serviço, barbeiro, data e horário.",
    input_schema: {
      type: "object",
      properties: {
        barbeiro_id: { type: "integer" },
        servico_id: { type: "integer" },
        nome_cliente: { type: "string", description: "Nome do cliente (já conhecido pelo contexto — use-o diretamente)" },
        data: { type: "string", description: "YYYY-MM-DD" },
        horario: { type: "string", description: "HH:MM" },
      },
      required: ["barbeiro_id", "servico_id", "nome_cliente", "data", "horario"],
    },
  },
  {
    name: "listar_meus_agendamentos",
    description: "Lista os agendamentos futuros deste cliente (identificado pelo telefone automaticamente). Use antes de cancelar ou reagendar, para saber o ID correto.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "cancelar_agendamento",
    description: "Cancela um agendamento existente deste cliente. Só chame depois de confirmar com o cliente qual agendamento (use o ID de listar_meus_agendamentos).",
    input_schema: {
      type: "object",
      properties: { agendamento_id: { type: "integer", description: "ID do agendamento (de listar_meus_agendamentos)" } },
      required: ["agendamento_id"],
    },
  },
  {
    name: "reagendar_agendamento",
    description: "Muda a data/horário de um agendamento existente deste cliente para um novo horário. Confirme a nova disponibilidade com verificar_horarios_disponiveis antes de chamar esta ferramenta.",
    input_schema: {
      type: "object",
      properties: {
        agendamento_id: { type: "integer", description: "ID do agendamento (de listar_meus_agendamentos)" },
        nova_data: { type: "string", description: "YYYY-MM-DD" },
        novo_horario: { type: "string", description: "HH:MM" },
      },
      required: ["agendamento_id", "nova_data", "novo_horario"],
    },
  },
  {
    name: "registrar_avaliacao",
    description: "Registra a avaliação (nota de 1 a 5 e comentário opcional) de um atendimento já concluído.",
    input_schema: {
      type: "object",
      properties: {
        agendamento_id: { type: "integer", description: "ID do agendamento avaliado" },
        nota: { type: "integer", description: "Nota de 1 a 5" },
        comentario: { type: "string", description: "Comentário opcional do cliente" },
      },
      required: ["agendamento_id", "nota"],
    },
    cache_control: { type: "ephemeral" },
  },
];

async function executeTool(barbershop: Barbershop, name: string, input: any, customerPhone: string): Promise<unknown> {
  switch (name) {
    case "listar_servicos": {
      const services = await getServices(barbershop.id);
      return services.map((s) => ({ id: s.id, nome: s.name, preco: formatPrice(s.priceCents), duracao_min: s.durationMin }));
    }
    case "listar_barbeiros": {
      const barbers = await getBarbers(barbershop.id);
      return barbers.map((b) => ({ id: b.id, nome: b.name }));
    }
    case "verificar_horarios_disponiveis": {
      const slots = await getAvailableSlots(barbershop.id, input.barbeiro_id, input.servico_id, input.data);
      return { data: input.data, horarios_disponiveis: slots };
    }
    case "buscar_proximo_horario_disponivel": {
      const found = await findNextAvailableDay(barbershop.id, input.barbeiro_id, input.servico_id, input.data_inicial);
      if (!found) return { encontrado: false, mensagem: "Nenhum horário livre encontrado nos próximos dias." };
      return { encontrado: true, ...found };
    }
    case "escalar_atendimento_humano": {
      const clientRecord = await getClientByPhone(customerPhone);
      await createEscalation(barbershop.id, { clientId: clientRecord?.id, clientPhone: customerPhone, reason: input.motivo });
      // Fire-and-forget: notificação é um "nice to have", não deve atrasar
      // nem quebrar a resposta ao cliente se o envio falhar.
      notifyEscalation(barbershop.id, clientRecord?.name ?? null, input.motivo).catch(() => {});
      return { escalado: true };
    }
    case "criar_agendamento": {
      const clientRecord = await findOrCreateClient(input.nome_cliente, customerPhone);
      // O bot avisa na confirmação que isso implica aceitar mensagens
      // futuras (ver buildStableSystemPrompt) — vale mesmo se o cliente já
      // tinha optado antes, então não precisa checar o valor atual.
      await markMarketingOptIn(clientRecord.id);
      const appointment = await createAppointment({
        barbershopId: barbershop.id,
        barberId: input.barbeiro_id,
        serviceId: input.servico_id,
        clientId: clientRecord.id,
        date: input.data,
        startTime: input.horario,
      });
      // Notifica barbeiros via push (fire-and-forget, não bloqueia a resposta)
      notifyNewAppointment(barbershop.id, appointment).catch(() => {});
      return {
        agendamento_id: appointment.id,
        confirmado: true,
        resumo: `${appointment.serviceName} com ${appointment.barberName} em ${appointment.date} às ${appointment.startTime}`,
        preco: formatPrice(appointment.priceCents),
        ics_url: icsUrl(appointment.id, customerPhone),
      };
    }
    case "listar_meus_agendamentos": {
      const appointments = await getAppointmentsByClientPhone(customerPhone, barbershop.id);
      return appointments.map((a) => ({
        id: a.id,
        servico: a.serviceName,
        barbeiro: a.barberName,
        data: a.date,
        horario: a.startTime,
        preco: formatPrice(a.priceCents),
      }));
    }
    case "cancelar_agendamento": {
      const appointment = await getAppointmentById(input.agendamento_id);
      if (!appointment || appointment.clientPhone !== customerPhone || appointment.barbershopId !== barbershop.id) {
        throw new Error("Agendamento não encontrado para este cliente.");
      }
      await cancelAppointment(input.agendamento_id);
      return { cancelado: true, agendamento_id: input.agendamento_id };
    }
    case "reagendar_agendamento": {
      const appointment = await getAppointmentById(input.agendamento_id);
      if (!appointment || appointment.clientPhone !== customerPhone || appointment.barbershopId !== barbershop.id) {
        throw new Error("Agendamento não encontrado para este cliente.");
      }
      const updated = await rescheduleAppointment(input.agendamento_id, input.nova_data, input.novo_horario);
      return { reagendado: true, agendamento_id: updated.id, nova_data: updated.date, novo_horario: updated.startTime, ics_url: icsUrl(updated.id, customerPhone) };
    }
    case "registrar_avaliacao": {
      const appointment = await getAppointmentById(input.agendamento_id);
      if (!appointment || appointment.clientPhone !== customerPhone || appointment.barbershopId !== barbershop.id) {
        throw new Error("Agendamento não encontrado para este cliente.");
      }
      if (input.nota < 1 || input.nota > 5) throw new Error("Nota deve ser entre 1 e 5.");
      await createReview({ appointmentId: input.agendamento_id, rating: input.nota, comment: input.comentario });
      return { avaliacao_registrada: true };
    }
    default:
      throw new Error(`Ferramenta desconhecida: ${name}`);
  }
}

// sessionId sozinho não é único entre tenants — no fluxo real do WhatsApp
// ele É o telefone do cliente (webhook chama sendMessage(shop.id, from, ...,
// from, ...)), e o mesmo telefone pode falar com barbearias diferentes
// (tenants diferentes) nesse SaaS. Como chat_sessions.session_id é chave
// primária, duas barbearias distintas colidiriam na mesma linha e uma
// sobrescreveria (upsert) o histórico da outra silenciosamente. Compor a
// chave de armazenamento com o barbershopId resolve isso sem precisar
// migrar o schema.
function storageKey(barbershopId: number, sessionId: string): string {
  return `${barbershopId}:${sessionId}`;
}

export async function resetSession(sessionId: string, barbershopId: number) {
  await prisma.chatSession.deleteMany({ where: { sessionId: storageKey(barbershopId, sessionId) } });
}

async function loadSession(sessionId: string, barbershopId: number): Promise<ChatSession> {
  const row = await prisma.chatSession.findUnique({ where: { sessionId: storageKey(barbershopId, sessionId) } });
  if (!row) return { barbershopId, messages: [] };
  return { barbershopId, messages: row.messages as unknown as Anthropic.MessageParam[] };
}

async function saveSession(sessionId: string, session: ChatSession) {
  const key = storageKey(session.barbershopId, sessionId);
  await prisma.chatSession.upsert({
    where: { sessionId: key },
    create: { sessionId: key, barbershopId: session.barbershopId, messages: session.messages as unknown as Prisma.InputJsonValue },
    update: { messages: session.messages as unknown as Prisma.InputJsonValue },
  });
}

export async function sendMessage(
  barbershopId: number,
  sessionId: string,
  userText: string,
  customerPhone: string,
  pushName?: string | null
): Promise<string> {
  const barbershop = await getBarbershop(barbershopId);
  if (!barbershop) throw new Error("Barbearia não encontrada");
  if (!customerPhone) throw new Error("Telefone do remetente (WhatsApp) é obrigatório");

  // Persistido no banco (não num Map em memória): em ambiente serverless,
  // mensagens consecutivas do mesmo cliente podem cair em instâncias
  // diferentes, e um Map local perderia o histórico no meio da conversa.
  const session = await loadSession(sessionId, barbershopId);

  session.messages.push({ role: "user", content: userText });

  const existingClient = await getClientByPhone(customerPhone);
  const pendingReview = await getUnreviewedCompletedAppointment(customerPhone, barbershopId);
  // Marcado assim que é apresentado ao modelo — ganhe ou perca, uma nova conversa
  // (system prompt novo) não deve insistir no mesmo pedido de novo.
  if (pendingReview) await markReviewPrompted(pendingReview.id);

  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: buildStableSystemPrompt(barbershop), cache_control: { type: "ephemeral" } },
    { type: "text", text: buildDynamicContext({ existingClient, pushName }, pendingReview) },
  ];

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system,
        tools,
        messages: session.messages,
      });

      session.messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return normalizeWhatsappFormatting(text) || "Desculpe, pode repetir?";
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        try {
          const result = await executeTool(barbershop, block.name, block.input, customerPhone);
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
        } catch (err) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Erro: ${(err as Error).message}`,
            is_error: true,
          });
        }
      }
      session.messages.push({ role: "user", content: toolResults });
    }

    return "Desculpe, tive um problema para processar seu pedido. Pode tentar novamente?";
  } finally {
    // Salva o que foi acumulado até aqui mesmo se um erro interromper o
    // loop no meio — melhor manter o progresso parcial da conversa do que
    // perder tudo silenciosamente.
    await saveSession(sessionId, session);
  }
}
