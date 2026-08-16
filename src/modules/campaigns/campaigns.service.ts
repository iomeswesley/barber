import { AppError } from "@/middleware/errorHandler.js";
import { getClientStats } from "@/modules/dashboard/clientStats.service.js";
import { getClientById } from "@/modules/clients/clients.repository.js";
import { getBarbershop } from "@/modules/businesses/businesses.repository.js";
import { getClientLastAppointment } from "@/modules/appointments/appointments.service.js";
import { sendComeBackMessage } from "@/jobs/reminders.js";
import { localDateStr } from "@/lib/time.js";
import {
  createCampaign,
  listCampaigns,
  incrementCampaignSentCount,
  getRecentlyCampaignedClientIds,
  recordCampaignSend,
  type CreateCampaignInput,
} from "./campaigns.repository.js";

// Nenhum cliente recebe mais de uma campanha (de qualquer campanha desta
// barbearia, não só a mesma) dentro dessa janela — pedido explícito, evita
// bombardear quem já foi convidado a voltar recentemente.
const RESEND_WINDOW_DAYS = 90;

export interface DispatchResult {
  campaignId: number;
  targeted: number;
  sent: number;
  skippedNoOptIn: number;
  skippedRecentlyCampaigned: number;
}

// Cria a campanha e já dispara pros clientes elegíveis, tudo numa chamada só
// (o formulário "Nova campanha de reativação" não tem um passo de revisão
// separado — cria e manda na hora, como o botão "Criar campanha" sugere).
export async function createAndDispatchCampaign(businessId: number, input: CreateCampaignInput): Promise<DispatchResult> {
  if (!input.name?.trim()) throw new AppError("Nome da campanha é obrigatório");
  if (!input.messageTemplate?.trim()) throw new AppError("Mensagem é obrigatória");
  if (!Number.isFinite(input.inactiveDaysThreshold) || input.inactiveDaysThreshold < 1) {
    throw new AppError("Dias de inatividade precisa ser um número maior que zero");
  }

  const campaign = await createCampaign(businessId, input);

  const [stats, barbershop, recentlyCampaigned] = await Promise.all([
    getClientStats(businessId),
    getBarbershop(businessId),
    getRecentlyCampaignedClientIds(businessId, RESEND_WINDOW_DAYS),
  ]);

  const todayStr = localDateStr(new Date());
  const targeted = stats.filter((c) => {
    if (!c.lastVisitDate) return false; // nunca veio -> não é "reativação", é lead frio
    const daysSince = Math.floor((new Date(todayStr).getTime() - new Date(c.lastVisitDate).getTime()) / 86400000);
    return daysSince >= input.inactiveDaysThreshold && !recentlyCampaigned.has(c.id);
  });

  let sent = 0;
  let skippedNoOptIn = 0;
  for (const c of targeted) {
    const client = await getClientById(c.id);
    // Mensagem de reconquista é categoria marketing na Meta — só pra quem
    // já deu opt-in (mesma regra do nudge individual/em massa existente).
    if (!client?.marketingOptIn) {
      skippedNoOptIn++;
      continue;
    }
    const lastAppointment = await getClientLastAppointment(c.id, businessId);
    // Reaproveita o template WhatsApp já aprovado (come_back_message) em vez
    // do texto livre digitado no formulário — ver comentário no schema
    // (model Campaign) pro motivo: texto livre fora da janela de 24h (o
    // caso de TODO cliente inativo, por definição) é rejeitado pela Cloud
    // API, então mandar o texto digitado direto falharia silenciosamente.
    await sendComeBackMessage(businessId, client.phone, client.name, barbershop?.name || "nossa barbearia", lastAppointment);
    await recordCampaignSend(campaign.id, c.id, businessId);
    sent++;
  }

  if (sent > 0) await incrementCampaignSentCount(campaign.id, sent);

  return {
    campaignId: campaign.id,
    targeted: targeted.length,
    sent,
    skippedNoOptIn,
    skippedRecentlyCampaigned: stats.filter((c) => c.lastVisitDate && recentlyCampaigned.has(c.id)).length,
  };
}

export async function getCampaignsForBusiness(businessId: number) {
  return listCampaigns(businessId);
}
