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
  category: "UTILITY" | "AUTHENTICATION";
  bodyText: string;
  paramCount: number;
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
  },
  {
    name: "appointment_reschedule_notice",
    category: "UTILITY",
    bodyText:
      "Olá, {{1}}! 😥 Precisamos remarcar seu horário de {{2}} com {{3}} às {{4}} no dia {{5}} por um imprevisto na nossa agenda. Desculpe o transtorno!\n\nPoderia responder aqui pra gente já encontrar um novo horário que funcione pra você? 🙏",
    paramCount: 5,
  },
  {
    name: "come_back_message",
    category: "UTILITY",
    bodyText:
      "Olá, {{1}}! Faz um tempinho que você não aparece na {{2}}. {{3}} Bora marcar um horário?",
    paramCount: 3,
  },
];

// Categoria AUTHENTICATION exige estrutura fixa da Meta (botão OTP obrigatório,
// sem texto livre no corpo) — tratado à parte de TEMPLATE_DEFINITIONS.
export const OTP_TEMPLATE_NAME = "client_plan_otp";
