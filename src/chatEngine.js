import Anthropic from "@anthropic-ai/sdk";
import {
  getBarbershop,
  getServices,
  getBarbers,
  getAvailableSlots,
  findOrCreateClient,
  getClientByPhone,
  createAppointment,
  getAppointmentsByClientPhone,
  getAppointmentById,
  cancelAppointment,
  rescheduleAppointment,
  getUnreviewedCompletedAppointment,
  createReview,
} from "./db.js";

const client = new Anthropic();
const MODEL = "claude-opus-4-8";
const MAX_ITERATIONS = 8;

const sessions = new Map(); // sessionId -> { barbershopId, messages: [] }

const WEEKDAYS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

function buildSystemPrompt(barbershop, identity, pendingReview) {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const weekday = WEEKDAYS[now.getDay()];

  let identityBlock;
  if (identity.existingClient) {
    identityBlock = `- Este é um cliente que já agendou antes. O nome dele já está registrado como "${identity.existingClient.name}". Use esse nome diretamente, sem perguntar de novo — só confirme se ele mesmo disser que o nome está errado.`;
  } else if (identity.pushName) {
    identityBlock = `- Cliente novo. O nome de perfil do WhatsApp dele é "${identity.pushName}". Use esse nome diretamente ao criar o agendamento, sem precisar perguntar — só ajuste se ele mencionar um nome diferente durante a conversa.`;
  } else {
    identityBlock = `- Cliente novo e sem nome de perfil disponível. Pergunte o nome dele em algum momento natural da conversa, antes de agendar.`;
  }

  const reviewBlock = pendingReview
    ? `\n\nATENÇÃO — pedido de avaliação pendente: este cliente teve um atendimento (ID ${pendingReview.id}: ${pendingReview.service_name} com ${pendingReview.barber_name} em ${pendingReview.date}) que ainda não foi avaliado. Antes de tratar do assunto principal da mensagem dele (ou logo depois, o que soar mais natural), pergunte de forma breve e simpática como foi esse atendimento e peça uma nota de 1 a 5 (e um comentário curto, opcional). Se ele responder com uma nota, use a ferramenta registrar_avaliacao com agendamento_id = ${pendingReview.id} (esse é o ID real — não peça isso ao cliente, você já sabe). Se ele ignorar ou disser que não quer avaliar, não insista — siga com o resto da conversa normalmente.`
    : "";

  return `Você é o assistente virtual de agendamentos da "${barbershop.name}", conversando por WhatsApp com clientes.

Contexto:
- Hoje é ${weekday}, ${todayIso} (formato YYYY-MM-DD).
- Horário de funcionamento: ${barbershop.opens_at} às ${barbershop.closes_at}.
- Endereço: ${barbershop.address || "não informado"}.
- O telefone deste cliente já é conhecido automaticamente pelo WhatsApp (é o próprio remetente da conversa) — NUNCA peça o telefone, o sistema já injeta isso sozinho ao agendar, cancelar ou reagendar.
${identityBlock}${reviewBlock}

Seu objetivo é conduzir uma conversa natural e breve. Você pode: agendar um novo horário, cancelar ou reagendar um horário já existente, e coletar avaliações. Siga este fluxo para agendar:
1. Descubra qual serviço o cliente deseja (use a ferramenta listar_servicos se precisar mostrar as opções com preços e duração).
2. Pergunte com qual barbeiro ele gostaria de ser atendido (use listar_barbeiros para mostrar os nomes). Se ele não tiver preferência, escolha um barbeiro e verifique a disponibilidade, ou ofereça verificar todos.
3. Pergunte o dia desejado e use verificar_horarios_disponiveis para checar horários livres. Converta datas relativas ("amanhã", "sexta-feira que vem") para o formato YYYY-MM-DD com base na data de hoje informada acima. Sugira 3 a 5 horários disponíveis.
4. Quando o cliente escolher um horário, confirme os detalhes (serviço, barbeiro, data, horário e preço) — NÃO peça nome nem telefone de novo, você já sabe quem é o cliente (veja o contexto acima).
5. Só depois de confirmação explícita do cliente, use a ferramenta criar_agendamento para gravar o agendamento.
6. Depois de agendar com sucesso, informe o cliente que o agendamento foi confirmado e inclua na sua resposta, de forma clara, o link para adicionar ao calendário que virá no resultado da ferramenta (campo ics_url) — escreva a URL completa como veio, sem alterar.

Para cancelar ou reagendar:
- Se o cliente quiser ver, cancelar ou remarcar um agendamento, use listar_meus_agendamentos primeiro para saber quais existem e pegar o ID correto — nunca invente um ID.
- Confirme com o cliente qual agendamento e a ação (cancelar ou o novo horário) antes de executar cancelar_agendamento ou reagendar_agendamento.
- Para reagendar, cheque a nova disponibilidade com verificar_horarios_disponiveis antes de confirmar com o cliente.

Regras de estilo:
- Seja cordial, direto e breve, como uma conversa real de WhatsApp — sem parágrafos longos.
- Não invente serviços, barbeiros, preços, horários ou IDs de agendamento: sempre use as ferramentas para obter dados reais.
- Se o cliente pedir algo fora do escopo (reclamações, perguntas gerais), responda educadamente e redirecione para o agendamento.`;
}

const tools = [
  {
    name: "listar_servicos",
    description:
      "Lista os serviços oferecidos pela barbearia, com nome, preço e duração em minutos.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "listar_barbeiros",
    description: "Lista os barbeiros que atendem nesta barbearia.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "verificar_horarios_disponiveis",
    description:
      "Verifica os horários livres de um barbeiro para um serviço em uma data específica. Use depois que o cliente escolher serviço, barbeiro e dia.",
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
    name: "criar_agendamento",
    description:
      "Grava o agendamento na base de dados. O telefone do cliente já é conhecido automaticamente (não faz parte desta ferramenta). Só chame depois que o cliente confirmar explicitamente serviço, barbeiro, data e horário.",
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
    description:
      "Lista os agendamentos futuros deste cliente (identificado pelo telefone automaticamente). Use antes de cancelar ou reagendar, para saber o ID correto.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "cancelar_agendamento",
    description:
      "Cancela um agendamento existente deste cliente. Só chame depois de confirmar com o cliente qual agendamento (use o ID de listar_meus_agendamentos).",
    input_schema: {
      type: "object",
      properties: {
        agendamento_id: { type: "integer", description: "ID do agendamento (de listar_meus_agendamentos)" },
      },
      required: ["agendamento_id"],
    },
  },
  {
    name: "reagendar_agendamento",
    description:
      "Muda a data/horário de um agendamento existente deste cliente para um novo horário. Confirme a nova disponibilidade com verificar_horarios_disponiveis antes de chamar esta ferramenta.",
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
  },
];

function executeTool(barbershop, name, input, customerPhone) {
  switch (name) {
    case "listar_servicos": {
      const services = getServices(barbershop.id);
      return services.map((s) => ({
        id: s.id,
        nome: s.name,
        preco: `R$ ${(s.price_cents / 100).toFixed(2)}`,
        duracao_min: s.duration_min,
      }));
    }
    case "listar_barbeiros": {
      const barbers = getBarbers(barbershop.id);
      return barbers.map((b) => ({ id: b.id, nome: b.name }));
    }
    case "verificar_horarios_disponiveis": {
      const slots = getAvailableSlots(
        barbershop.id,
        input.barbeiro_id,
        input.servico_id,
        input.data
      );
      return { data: input.data, horarios_disponiveis: slots };
    }
    case "criar_agendamento": {
      const clientRecord = findOrCreateClient(input.nome_cliente, customerPhone);
      const appointment = createAppointment({
        barbershopId: barbershop.id,
        barberId: input.barbeiro_id,
        serviceId: input.servico_id,
        clientId: clientRecord.id,
        date: input.data,
        startTime: input.horario,
      });
      return {
        agendamento_id: appointment.id,
        confirmado: true,
        resumo: `${appointment.service_name} com ${appointment.barber_name} em ${appointment.date} às ${appointment.start_time}`,
        preco: `R$ ${(appointment.price_cents / 100).toFixed(2)}`,
        ics_url: `/api/appointments/${appointment.id}/ics`,
      };
    }
    case "listar_meus_agendamentos": {
      const appointments = getAppointmentsByClientPhone(customerPhone, barbershop.id);
      return appointments.map((a) => ({
        id: a.id,
        servico: a.service_name,
        barbeiro: a.barber_name,
        data: a.date,
        horario: a.start_time,
        preco: `R$ ${(a.price_cents / 100).toFixed(2)}`,
      }));
    }
    case "cancelar_agendamento": {
      const appointment = getAppointmentById(input.agendamento_id);
      if (!appointment || appointment.client_phone !== customerPhone || appointment.barbershop_id !== barbershop.id) {
        throw new Error("Agendamento não encontrado para este cliente.");
      }
      cancelAppointment(input.agendamento_id);
      return { cancelado: true, agendamento_id: input.agendamento_id };
    }
    case "reagendar_agendamento": {
      const appointment = getAppointmentById(input.agendamento_id);
      if (!appointment || appointment.client_phone !== customerPhone || appointment.barbershop_id !== barbershop.id) {
        throw new Error("Agendamento não encontrado para este cliente.");
      }
      const updated = rescheduleAppointment(input.agendamento_id, input.nova_data, input.novo_horario);
      return {
        reagendado: true,
        agendamento_id: updated.id,
        nova_data: updated.date,
        novo_horario: updated.start_time,
        ics_url: `/api/appointments/${updated.id}/ics`,
      };
    }
    case "registrar_avaliacao": {
      const appointment = getAppointmentById(input.agendamento_id);
      if (!appointment || appointment.client_phone !== customerPhone || appointment.barbershop_id !== barbershop.id) {
        throw new Error("Agendamento não encontrado para este cliente.");
      }
      if (input.nota < 1 || input.nota > 5) {
        throw new Error("Nota deve ser entre 1 e 5.");
      }
      createReview({ appointmentId: input.agendamento_id, rating: input.nota, comment: input.comentario });
      return { avaliacao_registrada: true };
    }
    default:
      throw new Error(`Ferramenta desconhecida: ${name}`);
  }
}

export function resetSession(sessionId) {
  sessions.delete(sessionId);
}

export async function sendMessage(barbershopId, sessionId, userText, customerPhone, pushName) {
  const barbershop = getBarbershop(barbershopId);
  if (!barbershop) throw new Error("Barbearia não encontrada");
  if (!customerPhone) throw new Error("Telefone do remetente (WhatsApp) é obrigatório");

  let session = sessions.get(sessionId);
  if (!session || session.barbershopId !== barbershopId) {
    session = { barbershopId, messages: [] };
    sessions.set(sessionId, session);
  }

  session.messages.push({ role: "user", content: userText });

  const existingClient = getClientByPhone(customerPhone);
  const pendingReview = getUnreviewedCompletedAppointment(customerPhone, barbershopId);
  const system = buildSystemPrompt(barbershop, { existingClient, pushName }, pendingReview);

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
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return text || "Desculpe, pode repetir?";
    }

    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      let resultContent;
      try {
        const result = executeTool(barbershop, block.name, block.input, customerPhone);
        resultContent = JSON.stringify(result);
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Erro: ${err.message}`,
          is_error: true,
        });
        continue;
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: resultContent,
      });
    }
    session.messages.push({ role: "user", content: toolResults });
  }

  return "Desculpe, tive um problema para processar seu pedido. Pode tentar novamente?";
}
