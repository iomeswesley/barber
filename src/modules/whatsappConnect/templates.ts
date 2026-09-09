import { vertical } from "@/config/env.js";

// Templates recriados automaticamente na WABA de cada barbearia recém-conectada,
// pra reminders/reagendamento/reconquista/OTP funcionarem sem depender de o dono
// submeter isso manualmente no Business Manager. O texto aqui precisa ficar
// idêntico ao já aprovado na WABA da própria plataforma (usada hoje pra todas as
// barbearias antes desta feature) — nomes usados em src/jobs/reminders.ts e
// src/modules/clientPlans/clientPlans.service.ts. Se o texto abaixo divergir do
// que está de fato aprovado, ajustar aqui antes do primeiro rollout real.
export interface TemplateDefinition {
  name: string;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  bodyText: string;
  paramCount: number;
  // Valor de exemplo pra cada {{n}}, na ordem — a Meta EXIGE isso pra
  // qualquer template com variável (usado só na revisão, nunca enviado de
  // verdade pro cliente). Achado em produção (08/09): os 3 templates abaixo
  // foram rejeitados com rejected_reason "INVALID_FORMAT" na WABA da
  // Vintage porque createTemplates (whatsappConnect.service.ts) montava o
  // componente BODY sem "example" nenhum — confirmado direto na API do
  // Meta (GET .../message_templates), não só suposição. example.length
  // precisa bater com paramCount.
  example: string[];
}

export const TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
  {
    name: "appointment_reminder",
    category: "UTILITY",
    // {{5}} = link de confirmação (ver src/jobs/reminders.ts,
    // ensureConfirmationToken) — cliente clica e o agendamento vira
    // "confirmed" (distinção agendado/confirmado, GET/POST /confirmar.html
    // + POST /api/public/appointments/confirm).
    bodyText:
      `Olá, {{1}}! 👋 Passando pra lembrar do seu horário hoje:\n\n${vertical.brandEmoji} {{2}} com {{3}}\n🕐 {{4}}\n\nConfirme sua presença: {{5}}\n\nSe precisar remarcar, é só responder aqui.`,
    paramCount: 5,
    example: ["João", "Corte de cabelo", "Carlos", "hoje às 15h", "https://agenda-barb.vercel.app/api/public/appointments/confirm?token=abc123"],
  },
  {
    name: "appointment_reschedule_notice",
    category: "UTILITY",
    bodyText:
      "Olá, {{1}}! 😥 Precisamos remarcar seu horário de {{2}} com {{3}} às {{4}} no dia {{5}} por um imprevisto na nossa agenda. Desculpe o transtorno!\n\nPoderia responder aqui pra gente já encontrar um novo horário que funcione pra você? 🙏",
    paramCount: 5,
    example: ["João", "Corte de cabelo", "Carlos", "15h", "10/09"],
  },
  {
    name: "come_back_message",
    // Reconquista/reativação é conteúdo promocional de verdade (mesmo já
    // reconhecido no comentário de sendComeBackMessage, src/jobs/
    // reminders.ts: "Mensagem de reconquista é categoria MARKETING na
    // Meta") — mas esse template era submetido como UTILITY. A Meta
    // reclassificou sozinha pra MARKETING e rejeitou (INVALID_FORMAT,
    // confirmado na API) — categoria e o texto batendo evita essa
    // reclassificação bagunçar a revisão.
    category: "MARKETING",
    bodyText:
      "Olá, {{1}}! Faz um tempinho que você não aparece na {{2}}. {{3}} Bora marcar um horário?",
    paramCount: 3,
    example: ["João", "Barbearia Vintage", "Que tal já garantir seu próximo horário antes que a agenda fique cheia?"],
  },
];

// Categoria AUTHENTICATION exige estrutura fixa da Meta (botão OTP obrigatório,
// sem texto livre no corpo) — tratado à parte de TEMPLATE_DEFINITIONS.
export const OTP_TEMPLATE_NAME = "client_plan_otp";

// Garantia de que toda barbearia nova conectada a partir de agora manda
// template em formato aceitável pra Meta, sem depender de ninguém lembrar
// de preencher "example" corretamente ao editar/adicionar um template no
// futuro (foi exatamente a falta disso que gerou o INVALID_FORMAT real da
// Vintage em 09/09). Roda uma vez, na importação deste módulo — como
// whatsappConnect.service.ts importa TEMPLATE_DEFINITIONS e é importado a
// partir de app.ts, um template mal formado derruba o boot da aplicação
// (erro alto e imediato) em vez de só falhar silenciosamente meses depois,
// quando a próxima barbearia tentar conectar.
export function validateTemplateDefinition(tpl: TemplateDefinition): void {
  const found = [...tpl.bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const expected = Array.from({ length: tpl.paramCount }, (_, i) => i + 1);
  if (JSON.stringify([...found].sort((a, b) => a - b)) !== JSON.stringify(expected)) {
    throw new Error(
      `Template "${tpl.name}": variáveis no bodyText (${found.join(",") || "nenhuma"}) não batem com paramCount=${tpl.paramCount} — a Meta exige {{1}}..{{n}} sequenciais, sem pular número.`
    );
  }
  if (tpl.example.length !== tpl.paramCount) {
    throw new Error(
      `Template "${tpl.name}": example tem ${tpl.example.length} valor(es), mas paramCount é ${tpl.paramCount} — a Meta rejeita com INVALID_FORMAT se faltar exemplo pra alguma variável.`
    );
  }
  if (/^\{\{\d+\}\}/.test(tpl.bodyText) || /\{\{\d+\}\}$/.test(tpl.bodyText.trim())) {
    throw new Error(`Template "${tpl.name}": bodyText não pode começar nem terminar com uma variável (dangling parameter, rejeitado pela Meta).`);
  }
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(tpl.bodyText)) {
    throw new Error(`Template "${tpl.name}": duas variáveis não podem ficar coladas/adjacentes (rejeitado pela Meta) — precisa de texto entre elas.`);
  }
}

for (const tpl of TEMPLATE_DEFINITIONS) validateTemplateDefinition(tpl);
