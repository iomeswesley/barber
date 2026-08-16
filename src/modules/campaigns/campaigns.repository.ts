import { prisma } from "@/lib/prisma.js";

export interface CreateCampaignInput {
  name: string;
  messageTemplate: string;
  inactiveDaysThreshold: number;
}

export function createCampaign(businessId: number, input: CreateCampaignInput) {
  return prisma.campaign.create({
    data: {
      businessId,
      name: input.name,
      messageTemplate: input.messageTemplate,
      inactiveDaysThreshold: input.inactiveDaysThreshold,
    },
  });
}

export function listCampaigns(businessId: number) {
  return prisma.campaign.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
  });
}

export function incrementCampaignSentCount(campaignId: number, count: number) {
  return prisma.campaign.update({ where: { id: campaignId }, data: { sentCount: { increment: count } } });
}

// Telefones (não clientId — mais barato de indexar em memória) que já
// receberam QUALQUER campanha desta clínica nos últimos `windowDays` dias —
// usado pra nunca mandar campanha 2x pro mesmo paciente dentro da janela,
// mesmo que sejam campanhas diferentes.
export async function getRecentlyCampaignedClientIds(businessId: number, windowDays: number): Promise<Set<number>> {
  const since = new Date();
  since.setDate(since.getDate() - windowDays);
  const rows = await prisma.campaignSend.findMany({
    where: { businessId, sentAt: { gte: since } },
    select: { clientId: true },
    distinct: ["clientId"],
  });
  return new Set(rows.map((r) => r.clientId));
}

export function recordCampaignSend(campaignId: number, clientId: number, businessId: number) {
  return prisma.campaignSend.create({ data: { campaignId, clientId, businessId } });
}
