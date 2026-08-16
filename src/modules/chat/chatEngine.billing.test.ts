import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma.js";
import { sendMessage } from "./chatEngine.js";

// Cobre o bloqueio do bot por assinatura cancelada (mesmo critério do painel,
// ver isBillingBlocked em billing.service.ts): sendMessage precisa retornar
// o aviso fixo ANTES de chamar a Anthropic (senão o teste quebraria por
// falta de ANTHROPIC_API_KEY neste ambiente) e ainda assim salvar a
// mensagem do cliente no histórico.
describe("sendMessage: bloqueio por assinatura cancelada", () => {
  let business: { id: number };
  const sessionId = `teste-billing-bot-${Date.now()}`;
  const phone = `55119${Date.now().toString().slice(-8)}`;

  beforeAll(async () => {
    business = await prisma.business.create({ data: { name: "[teste] Bot Billing Gate" } });
    await prisma.subscription.create({ data: { businessId: business.id, status: "canceled" } });
  });

  afterAll(async () => {
    await prisma.chatSession.deleteMany({ where: { businessId: business.id } });
    await prisma.client.deleteMany({ where: { phone } });
    await prisma.subscription.deleteMany({ where: { businessId: business.id } });
    await prisma.business.deleteMany({ where: { id: business.id } });
  });

  it("responde com o aviso fixo em vez de chamar a IA, e marca a conversa como precisando de atenção", async () => {
    const reply = await sendMessage(business.id, sessionId, "Quero marcar um horário", phone, "Cliente Teste");
    expect(reply).toContain("não estamos com o atendimento automático disponível");

    const session = await prisma.chatSession.findUnique({
      where: { sessionId: `${business.id}:${sessionId}` },
    });
    expect(session?.needsAttention).toBe(true);
    const messages = session?.messages as unknown as { role: string; content: unknown }[];
    expect(messages?.some((m) => m.role === "user")).toBe(true);
  });
});
