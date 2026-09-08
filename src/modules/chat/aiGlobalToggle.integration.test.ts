import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma.js";
import { sendMessage } from "./chatEngine.js";

// Teste de integração real (banco real, sem mockar a Anthropic) — o
// interruptor geral (Business.aiGloballyPaused) retorna cedo, ANTES da
// chamada à API da IA, então dá pra testar sem precisar de chave/crédito
// da Anthropic. Ver comentário no schema e em sendMessage (chatEngine.ts).
describe("sendMessage respeita o interruptor geral de IA (aiGloballyPaused)", () => {
  let business: { id: number };
  const phone = `teste-ai-global-${Date.now()}`;

  beforeAll(async () => {
    business = await prisma.business.create({ data: { name: "[teste] IA Global Pausada", aiGloballyPaused: true } });
  });

  afterAll(async () => {
    await prisma.chatSession.deleteMany({ where: { businessId: business.id } });
    await prisma.client.deleteMany({ where: { phone } });
    await prisma.business.deleteMany({ where: { id: business.id } });
  });

  it("volta null (sem resposta), salva a mensagem e marca needsAttention, sem chamar a IA", async () => {
    const reply = await sendMessage(business.id, phone, "Quero agendar um corte", phone, "Cliente Teste");
    expect(reply).toBeNull();

    const key = `${business.id}:${phone}`;
    const session = await prisma.chatSession.findUnique({ where: { sessionId: key } });
    expect(session?.needsAttention).toBe(true);
    expect(JSON.stringify(session?.messages)).toContain("Quero agendar um corte");
  });
});
