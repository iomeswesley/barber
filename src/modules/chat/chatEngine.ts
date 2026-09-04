import Anthropic from "@anthropic-ai/sdk";
import { getBarbershop } from "@/modules/businesses/businesses.repository.js";
import { getServices } from "@/modules/services/services.repository.js";
import { getBarbers } from "@/modules/professionals/professionals.repository.js";
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
import {
  getOfferableClientPlans,
  verifyPhoneViaTrustedChannel,
  createClientPlanCheckoutSession,
} from "@/modules/clientPlans/clientPlans.service.js";
import { notifyNewAppointment, notifyEscalation } from "@/modules/push/push.service.js";
import { createWaitlistEntry } from "@/modules/waitlist/waitlist.repository.js";
import { sendWhatsappText, whatsappConfigured, resolveBarbershopAccessToken, uploadWhatsappMedia, sendWhatsappMedia } from "@/lib/whatsapp.js";
import { createShortLink } from "@/lib/shortLink.js";
import { prisma } from "@/lib/prisma.js";
import { env, vertical } from "@/config/env.js";
import { logChatUsage } from "./chatUsage.js";
import { isBillingBlocked } from "@/modules/billing/billing.service.js";
import type { Business, Prisma } from "@prisma/client";

const client = new Anthropic();
const MODEL = "claude-sonnet-5";
const MAX_ITERATIONS = 8;

interface ChatSession {
  businessId: number;
  messages: Anthropic.MessageParam[];
  aiPaused: boolean;
}

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

export function formatPrice(cents: number): string {
  return `R$ ${Math.round(cents / 100)}`;
}

export function describeClientPlanBenefit(
  plan: { benefitType: string; benefitValue: number; serviceId: number | null },
  serviceName?: string
): string {
  if (plan.benefitType === "unlimited_service") return `Acesso ilimitado a ${serviceName || "um serviço"}`;
  if (plan.benefitType === "services_included") {
    return `${plan.benefitValue}x ${serviceName || "serviço(s)"} incluído(s) por mês`;
  }
  if (plan.benefitType === "percent_discount") return `${plan.benefitValue}% de desconto em qualquer serviço`;
  return "";
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
export function normalizeWhatsappFormatting(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "*$1*");
}

// 4 presets fixos da aba Configurações → Personalidade da IA — texto curto
// injetado no prompt, complementar aos toneExamples (que continuam
// existindo pra quem quiser refinar com exemplos reais). Chave não usada
// (fallback "acolhedor") não quebra nada, só ignora a instrução de tom.
const AI_PERSONALITY_PROMPTS: Record<string, string> = {
  acolhedor: "Tom de voz: profissional e acolhedor — empático, humano e confiável, como uma recepção que trata bem quem chega.",
  formal: "Tom de voz: formal e objetivo — comunicação direta, sem rodeios, com tom institucional.",
  descontraido: "Tom de voz: amigável e descontraído — leve e próximo, como conversa entre conhecidos, mantendo o respeito.",
  tecnico: "Tom de voz: clínico e técnico — linguagem mais técnica, adequada a um público que já entende do assunto.",
};

function buildStableSystemPrompt(barbershop: Business & { opensAt?: string; closesAt?: string }): string {
  const { business: biz, professional: prof, client, service: svc, emergencyClause, planBenefitExample } = vertical;
  return `Você é o assistente virtual de agendamentos da ${biz}${vertical.businessAdjective} "${barbershop.name}", conversando por WhatsApp com ${vertical.clientPlural}.

${AI_PERSONALITY_PROMPTS[barbershop.aiPersonality] || AI_PERSONALITY_PROMPTS.acolhedor}

Endereço: ${barbershop.address || "não informado"}.
O telefone deste ${client} já é conhecido automaticamente pelo WhatsApp (é o próprio remetente da conversa) — NUNCA peça o telefone, o sistema já injeta isso sozinho ao agendar, cancelar ou reagendar.

Seu objetivo é conduzir uma conversa natural e breve. Você pode: agendar um novo horário, cancelar ou reagendar um horário já existente, e coletar avaliações. Siga este fluxo para agendar:
1. Descubra qual ${svc} o ${client} deseja (use a ferramenta listar_servicos se precisar mostrar as opções com preços e duração).
2. Pergunte com qual ${prof} ele gostaria de ser atendido (use listar_barbeiros para mostrar os nomes). Se ele não tiver preferência, escolha um ${prof} e verifique a disponibilidade, ou ofereça verificar todos.
3. Pergunte o dia desejado e use verificar_horarios_disponiveis para checar horários livres. Converta datas relativas ("amanhã", "sexta-feira que vem") para o formato YYYY-MM-DD com base na data de hoje informada no contexto abaixo. Sugira 3 a 5 horários disponíveis. Se o ${client} for vago sobre o dia ("qualquer dia", "não tenho preferência", "o mais rápido possível"), NÃO fique perguntando de novo — use a ferramenta buscar_proximo_horario_disponivel a partir de hoje e já sugira os horários encontrados.
4. Quando o ${client} escolher um horário, confirme os detalhes (${svc}, ${prof}, data, horário e preço) — NÃO peça nome nem telefone de novo, você já sabe quem é o ${client} (veja o contexto abaixo). Inclua também, de forma breve e natural (não como um termo legal formal), que ao confirmar o ${client} concorda em receber lembretes e mensagens futuras da ${biz} por aqui — ex: "Confirma? (ao confirmar, você topa receber lembretes e novidades nossas por aqui 😉)".
5. Só depois de confirmação explícita do ${client}, use a ferramenta criar_agendamento para gravar o agendamento.
6. Depois de agendar com sucesso, informe o ${client} que o agendamento foi confirmado e inclua na sua resposta, de forma clara, o link para adicionar ao calendário que virá no resultado da ferramenta (campo ics_url) — escreva a URL completa como veio, sem alterar.

Lista de espera:
- Se verificar_horarios_disponiveis ou buscar_proximo_horario_disponivel não encontrar NENHUM horário livre dentro do período que o ${client} realmente queria (ex: só aceita um dia específico, ou uma semana específica, e não tem nada nela), ofereça entrar na lista de espera antes de desistir — algo como "não tenho horário nesse período, mas posso te avisar se abrir uma vaga, quer entrar na lista de espera?". NÃO ofereça isso se o ${client} ainda nem tentou um horário específico, ou se ele só ainda não escolheu entre as opções livres que você já mostrou.
- Só chame entrar_lista_espera depois que o ${client} confirmar explicitamente que quer. Peça (ou use o que já sabe) o ${prof} de preferência (ou "qualquer um"), o ${svc}, e o período de datas que ele aceita.

Para cancelar ou reagendar:
- Se o ${client} quiser ver, cancelar ou remarcar um agendamento, use listar_meus_agendamentos primeiro para saber quais existem e pegar o ID correto — nunca invente um ID.
- Confirme com o ${client} qual agendamento e a ação (cancelar ou o novo horário) antes de executar cancelar_agendamento ou reagendar_agendamento.
- Para reagendar, cheque a nova disponibilidade com verificar_horarios_disponiveis antes de confirmar com o ${client}.

Planos de assinatura recorrente:
- Esta ${biz} pode oferecer planos de assinatura mensal pros próprios ${vertical.clientPlural} (ex: ${planBenefitExample}, desconto fixo). Se o ${client} perguntar sobre plano, assinatura, mensalidade ou fidelidade, use listar_planos_assinatura para ver o que está disponível — nunca invente nomes, preços ou benefícios.
- Se a lista vier vazia, diga que a ${biz} ainda não tem planos disponíveis no momento.
- Se o ${client} quiser assinar um plano específico, confirme qual plano antes de chamar assinar_plano_assinatura. NÃO peça telefone nem código de confirmação — o sistema já valida isso automaticamente pelo próprio WhatsApp. A ferramenta retorna um link de pagamento (checkout_url): envie esse link completo, sem alterar, e explique que o pagamento é processado pelo Stripe. Avise também, de forma breve, que se a tela do link ficar carregando sem abrir, é só tocar em "abrir no navegador" em vez de continuar dentro do próprio WhatsApp (é uma limitação conhecida do navegador embutido, não um erro).

Quando encaminhar para atendimento humano:
- Se o ${client} relatar uma reclamação séria (ex: cobrança indevida, atendimento muito ruim, algo que exige uma decisão que você não pode tomar)${emergencyClause} ou pedir explicitamente para falar com um humano/atendente, NÃO tente resolver sozinho. Use a ferramenta escalar_atendimento_humano com um resumo curto do motivo (uma vez só por assunto — não chame de novo só porque o ${client} repetiu o pedido) e informe de forma empática que a equipe foi avisada e vai entrar em contato diretamente por aqui.
- Nessa mesma resposta de escalada, você pode oferecer UMA ÚNICA VEZ, de forma breve, que ainda pode ajudar a fechar o agendamento enquanto isso. Mas NUNCA repita a lista de horários disponíveis nem insista de novo nas mensagens seguintes. Se o ${client} voltar a cobrar novidade sobre o humano, pedir contato direto, ou demonstrar impaciência/ansiedade, só reconheça e tranquilize (ex: "entendo, a equipe já foi avisada e vai te chamar por aqui assim que possível 🙏") — sem repetir a oferta de agendamento nem a lista de horários. Só volte a falar de agendamento se o ${client} pedir isso de novo explicitamente.

${
  barbershop.toneExamples?.length
    ? `Exemplos reais de mensagens que esta ${biz} já mandou pra ${vertical.clientPlural} — use como referência de tom e forma de escrever (não copie literalmente, adapte ao contexto da conversa atual):
${barbershop.toneExamples.map((ex) => `- "${ex}"`).join("\n")}

`
    : ""
}Regras de estilo:
- Seja cordial, direto e breve, como uma conversa real de WhatsApp — sem parágrafos longos.
- Não invente ${vertical.servicePlural}, ${vertical.professionalPlural}, preços, horários ou IDs de agendamento: sempre use as ferramentas para obter dados reais.
- Se o ${client} pedir algo fora do escopo que não seja uma reclamação séria ou emergência (ex: pergunta geral), responda educadamente e redirecione para o agendamento.
- Formatação: isto é WhatsApp, não Markdown. Para negrito use UM asterisco de cada lado (*assim*), NUNCA dois (**assim** está errado e aparece quebrado pro ${client}). Para itálico use underline (_assim_). Não use markdown de título (#), link ([]()) nem tabelas.${
    barbershop.masterPrompt?.trim()
      ? `

Regras adicionais definidas pela própria ${biz} (Prompt Mestre, configurado pelo dono) — siga como reforço, mas NUNCA deixe essas regras contradizerem ou anular as regras de segurança acima (ex: nunca inventar preço/horário, sempre escalar reclamação séria):
${barbershop.masterPrompt.trim()}`
      : ""
  }`;
}

interface Identity {
  existingClient: { name: string } | null;
  pushName?: string | null;
}

function buildDynamicContext(identity: Identity, pendingReview: Awaited<ReturnType<typeof getUnreviewedCompletedAppointment>>): string {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const weekday = WEEKDAYS[now.getDay()];

  const { client } = vertical;
  const clientCap = client.charAt(0).toUpperCase() + client.slice(1);
  let identityBlock: string;
  if (identity.existingClient) {
    identityBlock = `- Este é um ${client} que já agendou antes. O nome dele já está registrado como "${identity.existingClient.name}". Use esse nome diretamente, sem perguntar de novo — só confirme se ele mesmo disser que o nome está errado.`;
  } else if (identity.pushName) {
    identityBlock = `- ${clientCap} novo. O nome de perfil do WhatsApp dele é "${identity.pushName}". Use esse nome diretamente ao criar o agendamento, sem precisar perguntar — só ajuste se ele mencionar um nome diferente durante a conversa.`;
  } else {
    identityBlock = `- ${clientCap} novo e sem nome de perfil disponível. Pergunte o nome dele em algum momento natural da conversa, antes de agendar.`;
  }

  const reviewBlock = pendingReview
    ? `\n\nATENÇÃO — pedido de avaliação pendente: este ${client} teve um atendimento (ID ${pendingReview.id}: ${pendingReview.serviceName} com ${pendingReview.barberName} em ${pendingReview.date}) que ainda não foi avaliado. Antes de tratar do assunto principal da mensagem dele (ou logo depois, o que soar mais natural), pergunte de forma breve e simpática como foi esse atendimento e peça uma nota de 1 a 5 (e um comentário curto, opcional). Se ele responder com uma nota, use a ferramenta registrar_avaliacao com agendamento_id = ${pendingReview.id} (esse é o ID real — não peça isso ao ${client}, você já sabe). Se ele ignorar ou disser que não quer avaliar, não insista — siga com o resto da conversa normalmente.`
    : "";

  return `Contexto atual:
- Hoje é ${weekday}, ${todayIso} (formato YYYY-MM-DD). Essa é a ÚNICA referência de "hoje" válida —
  ignore qualquer data mencionada em mensagens anteriores desta conversa ao calcular "hoje",
  "amanhã" ou qualquer data relativa, mesmo que a conversa seja antiga ou já tenha falado de
  outros agendamentos em datas passadas. Nunca chame verificar_horarios_disponiveis,
  buscar_proximo_horario_disponivel ou criar_agendamento com uma data anterior a ${todayIso}.
${identityBlock}${reviewBlock}`;
}

const tools: Anthropic.Tool[] = [
  {
    name: "listar_servicos",
    description: `Lista os ${vertical.servicePlural} oferecidos pela ${vertical.business}, com nome, preço e duração em minutos.`,
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "listar_barbeiros",
    description: `Lista os ${vertical.professionalPlural} que atendem nesta ${vertical.business}.`,
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "verificar_horarios_disponiveis",
    description: `Verifica os horários livres de um ${vertical.professional} para um ${vertical.service} em uma data específica. Use depois que o ${vertical.client} escolher ${vertical.service}, ${vertical.professional} e dia.`,
    input_schema: {
      type: "object",
      properties: {
        barbeiro_id: { type: "integer", description: `ID do ${vertical.professional} (obtido de listar_barbeiros)` },
        servico_id: { type: "integer", description: "ID do serviço (obtido de listar_servicos)" },
        data: { type: "string", description: "Data no formato YYYY-MM-DD" },
      },
      required: ["barbeiro_id", "servico_id", "data"],
    },
  },
  {
    name: "buscar_proximo_horario_disponivel",
    description: `Varre os próximos dias a partir de uma data (pulando dias em que a ${vertical.business} está fechada) e retorna o primeiro dia com horários livres para o ${vertical.professional} e ${vertical.service} escolhidos. Use quando o ${vertical.client} não tiver preferência de dia, em vez de perguntar 'qual dia?' de novo.`,
    input_schema: {
      type: "object",
      properties: {
        barbeiro_id: { type: "integer", description: `ID do ${vertical.professional} (obtido de listar_barbeiros)` },
        servico_id: { type: "integer", description: "ID do serviço (obtido de listar_servicos)" },
        data_inicial: { type: "string", description: "A partir de qual data buscar, formato YYYY-MM-DD (normalmente hoje)" },
      },
      required: ["barbeiro_id", "servico_id", "data_inicial"],
    },
  },
  {
    name: "escalar_atendimento_humano",
    description: `Sinaliza para a equipe da ${vertical.business} que este ${vertical.client} precisa de atendimento humano (reclamação séria, emergência, ou algo que você não pode resolver). Use no lugar de tentar resolver sozinho ou insistir no agendamento.`,
    input_schema: {
      type: "object",
      properties: { motivo: { type: "string", description: "Resumo curto do motivo da escalada, para a equipe entender rapidamente o contexto" } },
      required: ["motivo"],
    },
  },
  {
    name: "criar_agendamento",
    description: `Grava o agendamento na base de dados. O telefone do ${vertical.client} já é conhecido automaticamente (não faz parte desta ferramenta). Só chame depois que o ${vertical.client} confirmar explicitamente ${vertical.service}, ${vertical.professional}, data e horário.`,
    input_schema: {
      type: "object",
      properties: {
        barbeiro_id: { type: "integer" },
        servico_id: { type: "integer" },
        nome_cliente: { type: "string", description: `Nome do ${vertical.client} (já conhecido pelo contexto — use-o diretamente)` },
        data: { type: "string", description: "YYYY-MM-DD" },
        horario: { type: "string", description: "HH:MM" },
      },
      required: ["barbeiro_id", "servico_id", "nome_cliente", "data", "horario"],
    },
  },
  {
    name: "entrar_lista_espera",
    description: `Coloca o ${vertical.client} na lista de espera de um período sem horário livre — avisa por WhatsApp automaticamente se abrir uma vaga (ex: cancelamento) nesse período. Só chame depois que verificar_horarios_disponiveis ou buscar_proximo_horario_disponivel não encontrar nada no período desejado E o ${vertical.client} confirmar que quer entrar na lista.`,
    input_schema: {
      type: "object",
      properties: {
        barbeiro_id: { type: "integer", description: `ID do ${vertical.professional} de preferência (obtido de listar_barbeiros) — omita se aceitar qualquer um` },
        servico_id: { type: "integer", description: "ID do serviço (obtido de listar_servicos)" },
        data_inicial: { type: "string", description: "Início do período aceito, YYYY-MM-DD" },
        data_final: { type: "string", description: "Fim do período aceito, YYYY-MM-DD (igual a data_inicial se for um único dia)" },
        nome_cliente: { type: "string", description: `Nome do ${vertical.client} (já conhecido pelo contexto — use-o diretamente)` },
      },
      required: ["servico_id", "data_inicial", "data_final", "nome_cliente"],
    },
  },
  {
    name: "listar_meus_agendamentos",
    description: `Lista os agendamentos futuros deste ${vertical.client} (identificado pelo telefone automaticamente). Use antes de cancelar ou reagendar, para saber o ID correto.`,
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "cancelar_agendamento",
    description: `Cancela um agendamento existente deste ${vertical.client}. Só chame depois de confirmar com o ${vertical.client} qual agendamento (use o ID de listar_meus_agendamentos).`,
    input_schema: {
      type: "object",
      properties: { agendamento_id: { type: "integer", description: "ID do agendamento (de listar_meus_agendamentos)" } },
      required: ["agendamento_id"],
    },
  },
  {
    name: "reagendar_agendamento",
    description: `Muda a data/horário de um agendamento existente deste ${vertical.client} para um novo horário. Confirme a nova disponibilidade com verificar_horarios_disponiveis antes de chamar esta ferramenta.`,
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
    name: "listar_planos_assinatura",
    description: `Lista os planos de assinatura recorrente que esta ${vertical.business} oferece pros próprios ${vertical.clientPlural} (ex: ${vertical.planBenefitExample}, desconto fixo). Use quando o ${vertical.client} perguntar sobre planos, assinatura, mensalidade ou fidelidade.`,
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "assinar_plano_assinatura",
    description: `Inicia a assinatura de um plano recorrente pro ${vertical.client} e retorna um link de pagamento do Stripe. O telefone do ${vertical.client} já é conhecido e validado automaticamente pelo WhatsApp (não faz parte desta ferramenta, não peça código). Só chame depois que o ${vertical.client} confirmar explicitamente qual plano quer assinar.`,
    input_schema: {
      type: "object",
      properties: {
        plano_id: { type: "integer", description: "ID do plano (obtido de listar_planos_assinatura)" },
        nome_cliente: { type: "string", description: `Nome do ${vertical.client} (já conhecido pelo contexto — use-o diretamente)` },
      },
      required: ["plano_id", "nome_cliente"],
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
        comentario: { type: "string", description: `Comentário opcional do ${vertical.client}` },
      },
      required: ["agendamento_id", "nota"],
    },
    cache_control: { type: "ephemeral" },
  },
];

async function executeTool(barbershop: Business, name: string, input: any, customerPhone: string): Promise<unknown> {
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
      await setNeedsAttention(barbershop.id, customerPhone, true);
      // Notificação é um "nice to have" — nunca deve quebrar a resposta ao
      // cliente se o envio falhar (notifyEscalation já engole erro
      // internamente). Precisa de `await` (não fire-and-forget) porque o
      // processo roda como função serverless na Vercel: a execução pode ser
      // congelada assim que este handler terminar, matando uma Promise
      // solta antes dela completar o envio do push.
      await notifyEscalation(barbershop.id, clientRecord?.name ?? null, input.motivo);
      return { escalado: true };
    }
    case "criar_agendamento": {
      const clientRecord = await findOrCreateClient(input.nome_cliente, customerPhone);
      // O bot avisa na confirmação que isso implica aceitar mensagens
      // futuras (ver buildStableSystemPrompt) — vale mesmo se o cliente já
      // tinha optado antes, então não precisa checar o valor atual.
      await markMarketingOptIn(clientRecord.id);
      const appointment = await createAppointment({
        businessId: barbershop.id,
        professionalId: input.barbeiro_id,
        serviceId: input.servico_id,
        clientId: clientRecord.id,
        date: input.data,
        startTime: input.horario,
      });
      // Notifica barbeiros via push — `await` pelo mesmo motivo da
      // escalação acima (serverless na Vercel).
      await notifyNewAppointment(barbershop.id, appointment);
      return {
        agendamento_id: appointment.id,
        confirmado: true,
        resumo: `${appointment.serviceName} com ${appointment.barberName} em ${appointment.date} às ${appointment.startTime}`,
        preco: formatPrice(appointment.priceCents),
        ics_url: icsUrl(appointment.id, customerPhone),
      };
    }
    case "entrar_lista_espera": {
      if (String(input.data_inicial) > String(input.data_final)) throw new Error("data_inicial não pode ser depois de data_final.");
      const clientRecord = await findOrCreateClient(input.nome_cliente, customerPhone);
      const entry = await createWaitlistEntry(barbershop.id, {
        clientId: clientRecord.id,
        professionalId: input.barbeiro_id || null,
        serviceId: input.servico_id,
        desiredDateStart: input.data_inicial,
        desiredDateEnd: input.data_final,
      });
      return { entrou_na_lista_espera: true, lista_espera_id: entry.id };
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
      if (!appointment || appointment.clientPhone !== customerPhone || appointment.businessId !== barbershop.id) {
        throw new Error(`Agendamento não encontrado para este ${vertical.client}.`);
      }
      await cancelAppointment(input.agendamento_id);
      return { cancelado: true, agendamento_id: input.agendamento_id };
    }
    case "reagendar_agendamento": {
      const appointment = await getAppointmentById(input.agendamento_id);
      if (!appointment || appointment.clientPhone !== customerPhone || appointment.businessId !== barbershop.id) {
        throw new Error(`Agendamento não encontrado para este ${vertical.client}.`);
      }
      const updated = await rescheduleAppointment(input.agendamento_id, input.nova_data, input.novo_horario);
      return { reagendado: true, agendamento_id: updated.id, nova_data: updated.date, novo_horario: updated.startTime, ics_url: icsUrl(updated.id, customerPhone) };
    }
    case "registrar_avaliacao": {
      const appointment = await getAppointmentById(input.agendamento_id);
      if (!appointment || appointment.clientPhone !== customerPhone || appointment.businessId !== barbershop.id) {
        throw new Error(`Agendamento não encontrado para este ${vertical.client}.`);
      }
      if (input.nota < 1 || input.nota > 5) throw new Error("Nota deve ser entre 1 e 5.");
      await createReview({ appointmentId: input.agendamento_id, rating: input.nota, comment: input.comentario });
      return { avaliacao_registrada: true };
    }
    case "listar_planos_assinatura": {
      const plans = await getOfferableClientPlans(barbershop.id);
      if (plans.length === 0) return { planos: [], mensagem: "Esta barbearia ainda não tem planos de assinatura disponíveis no momento." };
      const services = await getServices(barbershop.id);
      const serviceNameById = new Map(services.map((s) => [s.id, s.name]));
      return {
        planos: plans.map((p) => ({
          id: p.id,
          nome: p.name,
          preco_mensal: formatPrice(p.priceCents),
          beneficio: describeClientPlanBenefit(p, p.serviceId ? serviceNameById.get(p.serviceId) : undefined),
        })),
      };
    }
    case "assinar_plano_assinatura": {
      // Diferente do checkout público (assinar-plano.html), aqui o telefone
      // já veio autenticado pela própria Meta (é o remetente real da
      // mensagem) — dispensa o código OTP que faz sentido só quando
      // qualquer visitante anônimo pode digitar qualquer telefone.
      await verifyPhoneViaTrustedChannel(customerPhone);
      const base = env.PUBLIC_BASE_URL || "";
      const url = await createClientPlanCheckoutSession(
        input.plano_id,
        customerPhone,
        input.nome_cliente,
        `${base}/assinar-plano.html?plan=${input.plano_id}&status=success`,
        `${base}/assinar-plano.html?plan=${input.plano_id}&status=cancel`
      );
      // URL de Checkout Session do Stripe é enorme — encurta antes de mandar
      // por WhatsApp (ver src/lib/shortLink.ts).
      const code = await createShortLink(url);
      return {
        checkout_url: `${base}/ir/${code}`,
        mensagem: `Link de pagamento gerado — envie esse link completo pro ${vertical.client} concluir a assinatura. Se a tela ficar carregando sem abrir, oriente o ${vertical.client} a abrir no navegador (Chrome/Safari) em vez de continuar dentro do próprio WhatsApp.`,
      };
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
// chave de armazenamento com o businessId resolve isso sem precisar
// migrar o schema.
function storageKey(businessId: number, sessionId: string): string {
  return `${businessId}:${sessionId}`;
}

export async function resetSession(sessionId: string, businessId: number) {
  await prisma.chatSession.deleteMany({ where: { sessionId: storageKey(businessId, sessionId) } });
}

// updateMany (não update) de propósito: a linha pode ainda não existir (ex:
// escalação na primeiríssima mensagem do cliente, antes da sessão ser
// salva) — nesse caso não há o que marcar, e updateMany simplesmente não
// afeta nenhuma linha em vez de lançar erro de "record not found".
async function setNeedsAttention(businessId: number, phone: string, value: boolean): Promise<void> {
  await prisma.chatSession.updateMany({ where: { sessionId: storageKey(businessId, phone) }, data: { needsAttention: value } });
}

// Toggle "IA Ativa" da aba Mensagens (webroot/admin.html) — pausar
// interrompe as respostas automáticas dessa conversa (ver sendMessage);
// upsert porque o dono pode pausar antes de qualquer mensagem já ter
// criado a sessão.
export async function setAiPaused(businessId: number, phone: string, paused: boolean): Promise<void> {
  const key = storageKey(businessId, phone);
  await prisma.chatSession.upsert({
    where: { sessionId: key },
    create: { sessionId: key, businessId, messages: [] as unknown as Prisma.InputJsonValue, aiPaused: paused },
    update: { aiPaused: paused },
  });
}

export interface ChatTranscriptEntry {
  role: "customer" | "bot";
  text: string;
}

// Content blocks de tool_use/tool_result são "conversa interna" entre o bot
// e o próprio sistema (ex: consultar horários) — não foram digitados por
// ninguém, então ficam de fora da transcrição pro dono ver só o diálogo real.
// Compartilhado entre getChatTranscript (transcrição completa) e
// listChatSessionsForBarbershop (só a última mensagem, pra lista/resumo).
function messagesToTranscriptEntries(messages: Anthropic.MessageParam[]): ChatTranscriptEntry[] {
  const entries: ChatTranscriptEntry[] = [];
  for (const message of messages) {
    if (typeof message.content === "string") {
      if (message.role === "user") entries.push({ role: "customer", text: message.content });
      continue;
    }
    if (message.role !== "assistant") continue; // "user" com content em array é tool_result, não mensagem real
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) entries.push({ role: "bot", text });
  }
  return entries;
}

// Lista as conversas da barbearia pro dono conseguir ver o que o cliente
// mandou e o que o bot respondeu. sessionId é o telefone (wa_id) no fluxo
// real do WhatsApp — prefixado com "<businessId>:" desde a correção de
// isolamento entre tenants (ver storageKey), mas linhas gravadas antes
// dessa correção guardam o telefone puro, sem prefixo. Como já filtramos
// por businessId na query, tratar as duas formas aqui é seguro (não
// vaza conversa de outra barbearia) e evita esconder histórico real de
// cliente só porque é anterior à correção. Inclui também se precisa de
// atenção humana (ver setNeedsAttention) e se a IA está pausada (ver
// setAiPaused) — mais um resumo (última mensagem real + contagem) pra não
// precisar abrir a conversa só pra saber do que se trata.
export async function listChatSessionsForBarbershop(businessId: number) {
  const sessions = await prisma.chatSession.findMany({
    where: { businessId },
    orderBy: { updatedAt: "desc" },
    select: { sessionId: true, updatedAt: true, needsAttention: true, aiPaused: true, messages: true },
  });
  const prefix = `${businessId}:`;
  return sessions.map((s) => {
    const entries = messagesToTranscriptEntries((s.messages as unknown as Anthropic.MessageParam[]) || []);
    const last = entries[entries.length - 1];
    return {
      phone: s.sessionId.startsWith(prefix) ? s.sessionId.slice(prefix.length) : s.sessionId,
      updatedAt: s.updatedAt,
      needsAttention: s.needsAttention,
      aiPaused: s.aiPaused,
      messageCount: entries.length,
      lastMessage: last ? { role: last.role, text: last.text.slice(0, 140) } : null,
    };
  });
}

// Content blocks de tool_use/tool_result são "conversa interna" entre o bot
// e o próprio sistema (ex: consultar horários) — não foram digitados por
// ninguém, então ficam de fora da transcrição pro dono ver só o diálogo real.
export async function getChatTranscript(businessId: number, phone: string): Promise<ChatTranscriptEntry[]> {
  // Tenta a chave atual (prefixada) primeiro; cai pro telefone puro se for
  // uma conversa anterior à correção de isolamento entre tenants (mesma
  // ressalva de listChatSessionsForBarbershop acima).
  let row = await prisma.chatSession.findUnique({ where: { sessionId: storageKey(businessId, phone) } });
  if (!row) row = await prisma.chatSession.findFirst({ where: { sessionId: phone, businessId } });
  const messages = (row?.messages as unknown as Anthropic.MessageParam[]) || [];
  return messagesToTranscriptEntries(messages);
}

// Envia uma mensagem manual do dono/barbeiro pro cliente, fora do fluxo da
// IA — mesmo phoneNumberId do webhook, e a mensagem entra na mesma sessão
// gravada no banco (storageKey = telefone, igual ao webhook) pra aparecer no
// histórico do painel e a IA não "esquecer" o que o humano já respondeu.
export async function sendManualMessage(businessId: number, phone: string, text: string): Promise<void> {
  const barbershop = await getBarbershop(businessId);
  if (!barbershop) throw new Error("Barbearia não encontrada");
  if (!whatsappConfigured || !barbershop.whatsappPhoneNumberId) {
    throw new Error("Esta barbearia ainda não tem WhatsApp configurado.");
  }

  await sendWhatsappText(barbershop.whatsappPhoneNumberId, phone, text);

  const key = storageKey(businessId, phone);
  await prisma.$transaction(async (tx) => {
    await tx.chatSession.upsert({
      where: { sessionId: key },
      create: { sessionId: key, businessId, messages: [] as unknown as Prisma.InputJsonValue },
      update: {},
    });
    await tx.$queryRaw`SELECT 1 FROM "chat_sessions" WHERE "session_id" = ${key} FOR UPDATE`;

    const session = await loadSession(tx, phone, businessId);
    session.messages.push({ role: "assistant", content: [{ type: "text", text }] });
    await saveSession(tx, phone, session);
    // Dono/barbeiro respondeu — a conversa deixa de "precisar de atenção"
    // na lista da aba Mensagens (ver setNeedsAttention).
    await tx.chatSession.update({ where: { sessionId: key }, data: { needsAttention: false } });
  });
}

// Anexo (imagem/PDF) enviado manualmente pelo dono/barbeiro, pela aba
// Mensagens — upload em 2 passos na Cloud API (ver uploadWhatsappMedia) e
// registra um texto marcador no histórico ("[Anexo enviado: nome.pdf]"),
// já que o formato de mensagem salvo aqui é texto simples, não binário; o
// arquivo em si não fica arquivado no nosso banco, só passou pela Meta.
export async function sendManualAttachment(
  businessId: number,
  phone: string,
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<void> {
  const barbershop = await getBarbershop(businessId);
  if (!barbershop) throw new Error("Barbearia não encontrada");
  if (!whatsappConfigured || !barbershop.whatsappPhoneNumberId) {
    throw new Error("Esta barbearia ainda não tem WhatsApp configurado.");
  }
  const accessToken = resolveBarbershopAccessToken(barbershop);
  const mediaId = await uploadWhatsappMedia(barbershop.whatsappPhoneNumberId, fileBuffer, mimeType, fileName, accessToken);
  await sendWhatsappMedia(barbershop.whatsappPhoneNumberId, phone, mediaId, mimeType, fileName, accessToken);

  const key = storageKey(businessId, phone);
  await prisma.$transaction(async (tx) => {
    await tx.chatSession.upsert({
      where: { sessionId: key },
      create: { sessionId: key, businessId, messages: [] as unknown as Prisma.InputJsonValue },
      update: {},
    });
    await tx.$queryRaw`SELECT 1 FROM "chat_sessions" WHERE "session_id" = ${key} FOR UPDATE`;

    const session = await loadSession(tx, phone, businessId);
    session.messages.push({ role: "assistant", content: [{ type: "text", text: `[Anexo enviado: ${fileName}]` }] });
    await saveSession(tx, phone, session);
    await tx.chatSession.update({ where: { sessionId: key }, data: { needsAttention: false } });
  });
}

// Mesma ressalva de getChatTranscript/listChatSessionsForBarbershop: sessões
// gravadas antes da correção de isolamento entre tenants usam a chave antiga,
// sem prefixo (telefone puro). Sem esse fallback, sendMessage (bot) e
// sendManualMessage (dono) criariam uma sessão NOVA vazia pra esse telefone
// em vez de continuar a conversa existente — duplicando a entrada na lista
// do painel e "perdendo" todo o histórico anterior aos olhos do dono. Aqui a
// sessão legada é apagada assim que lida, pra saveSession já gravar tudo
// (histórico antigo + mensagem nova) na chave atual — migração feita na
// primeira vez que a sessão for tocada de novo.
// Roda fora da transação com lock (ver sendMessage): é um caso raro e
// histórico (sessões gravadas antes da correção de isolamento entre
// tenants), não vale segurar a linha nova por causa dele.
async function migrateLegacySessionIfNeeded(sessionId: string, businessId: number) {
  const key = storageKey(businessId, sessionId);
  const primaryExists = await prisma.chatSession.findUnique({ where: { sessionId: key }, select: { sessionId: true } });
  if (primaryExists) return;

  const legacyRow = await prisma.chatSession.findFirst({ where: { sessionId, businessId } });
  if (legacyRow) {
    await prisma.chatSession.delete({ where: { sessionId: legacyRow.sessionId } }).catch(() => {});
    await prisma.chatSession
      .create({ data: { sessionId: key, businessId, messages: legacyRow.messages as unknown as Prisma.InputJsonValue } })
      .catch(() => {});
  }
}

async function loadSession(db: Prisma.TransactionClient, sessionId: string, businessId: number): Promise<ChatSession> {
  const key = storageKey(businessId, sessionId);
  const row = await db.chatSession.findUnique({ where: { sessionId: key } });
  return { businessId, messages: (row?.messages as unknown as Anthropic.MessageParam[]) ?? [], aiPaused: row?.aiPaused ?? false };
}

async function saveSession(db: Prisma.TransactionClient, sessionId: string, session: ChatSession) {
  const key = storageKey(session.businessId, sessionId);
  await db.chatSession.upsert({
    where: { sessionId: key },
    create: { sessionId: key, businessId: session.businessId, messages: session.messages as unknown as Prisma.InputJsonValue },
    update: { messages: session.messages as unknown as Prisma.InputJsonValue },
  });
}

export async function sendMessage(
  businessId: number,
  sessionId: string,
  userText: string,
  customerPhone: string,
  pushName?: string | null
): Promise<string | null> {
  const barbershop = await getBarbershop(businessId);
  if (!barbershop) throw new Error("Barbearia não encontrada");
  if (!customerPhone) throw new Error("Telefone do remetente (WhatsApp) é obrigatório");

  await migrateLegacySessionIfNeeded(sessionId, businessId);

  const existingClient = await getClientByPhone(customerPhone);
  const pendingReview = await getUnreviewedCompletedAppointment(customerPhone, businessId);
  // Marcado assim que é apresentado ao modelo — ganhe ou perca, uma nova conversa
  // (system prompt novo) não deve insistir no mesmo pedido de novo.
  if (pendingReview) await markReviewPrompted(pendingReview.id);

  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: buildStableSystemPrompt(barbershop), cache_control: { type: "ephemeral" } },
    { type: "text", text: buildDynamicContext({ existingClient, pushName }, pendingReview) },
  ];

  const key = storageKey(businessId, sessionId);

  // Toda a sessão é lida, processada pela IA e salva dentro de UMA transação
  // com lock de linha (FOR UPDATE): se o cliente mandar duas mensagens em
  // sequência rápida, elas chegam como dois webhooks concorrentes — sem esse
  // lock, os dois liam a sessão "vazia" ao mesmo tempo e o modelo respondia
  // com saudação duas vezes. Com o lock, a segunda chamada espera a primeira
  // commitar e já enxerga o histórico atualizado. Persistido no banco (não
  // num Map em memória) porque em ambiente serverless mensagens consecutivas
  // do mesmo cliente podem cair em instâncias diferentes.
  return prisma.$transaction(
    async (tx) => {
      await tx.chatSession.upsert({
        where: { sessionId: key },
        create: { sessionId: key, businessId, messages: [] as unknown as Prisma.InputJsonValue },
        update: {},
      });
      await tx.$queryRaw`SELECT 1 FROM "chat_sessions" WHERE "session_id" = ${key} FOR UPDATE`;

      const session = await loadSession(tx, sessionId, businessId);
      session.messages.push({ role: "user", content: userText });

      // Assinatura cancelada (trial vencido sem virar pagamento, ou
      // assinatura paga que o Stripe desistiu de cobrar) — mesmo critério e
      // função do bloqueio do painel (requireBillingOk), aplicado aqui
      // porque HTTP 402 não faz sentido pro cliente final do WhatsApp: grava
      // a mensagem normalmente (histórico não se perde pra quando a
      // barbearia reativar) e marca "precisa de atenção", mas responde com
      // um aviso fixo em vez de gastar tokens chamando a IA.
      const billingBlocked = await isBillingBlocked(businessId);
      if (billingBlocked) {
        await saveSession(tx, sessionId, session);
        await tx.chatSession.update({ where: { sessionId: key }, data: { needsAttention: true } });
        return "No momento não estamos com o atendimento automático disponível. Em breve alguém vai te responder por aqui, obrigado pela paciência!";
      }

      // Toggle "IA Ativa" pausado (aba Mensagens) — grava a mensagem do
      // cliente pro histórico e marca "precisa de atenção" (ninguém
      // automático está respondendo), mas NÃO gera nem manda resposta.
      // O dono/barbeiro responde manualmente via sendManualMessage.
      if (session.aiPaused) {
        await saveSession(tx, sessionId, session);
        await tx.chatSession.update({ where: { sessionId: key }, data: { needsAttention: true } });
        return null;
      }

      try {
        for (let i = 0; i < MAX_ITERATIONS; i++) {
          // Fluxo é mecânico (seguir passos, chamar ferramentas, textos
          // curtos) — não precisa de raciocínio profundo. "low" corta o
          // gasto de thinking adaptativo (ligado por padrão no Sonnet 5)
          // sem trocar de modelo.
          const response = await client.messages.create({
            model: MODEL,
            max_tokens: 1024,
            system,
            tools,
            messages: session.messages,
            output_config: { effort: "low" },
          });

          await logChatUsage(businessId, MODEL, response.usage);

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
        await saveSession(tx, sessionId, session);
      }
    },
    { timeout: 30_000 }
  );
}
