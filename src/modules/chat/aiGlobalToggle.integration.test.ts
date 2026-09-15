import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma.js";
import { sendMessage, recordIncomingMessage, generateReplyFromHistory } from "./chatEngine.js";

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

// Regressão de um bug real relatado em produção: "desativei a IA no toggle
// mas continua respondendo sozinho". Causa: no webhook real, existe uma
// janela de debounce (até WHATSAPP_REPLY_DEBOUNCE_MS) entre gravar a
// mensagem (recordIncomingMessage, que checa aiGloballyPaused no momento em
// que a mensagem chega) e gerar a resposta (generateReplyFromHistory,
// chamada só depois da espera). Se o dono desativa o toggle DURANTE essa
// janela, generateReplyFromHistory reconfere o toggle e não deve chamar a
// IA nem responder — não basta ter checado só na hora de gravar.
describe("generateReplyFromHistory reconfere aiGloballyPaused (janela de debounce)", () => {
  let business: { id: number };
  const phone = `teste-ai-global-debounce-${Date.now()}`;

  beforeAll(async () => {
    business = await prisma.business.create({ data: { name: "[teste] IA Global Pausada Depois", aiGloballyPaused: false } });
  });

  afterAll(async () => {
    await prisma.chatSession.deleteMany({ where: { businessId: business.id } });
    await prisma.client.deleteMany({ where: { phone } });
    await prisma.business.deleteMany({ where: { id: business.id } });
  });

  it("mensagem gravada com a IA ativa, mas pausada antes da resposta ser gerada: não responde", async () => {
    const recorded = await recordIncomingMessage(business.id, phone, "Quero agendar um corte", phone);
    expect(recorded.status).toBe("queued");

    // Dono desativa o toggle geral aqui, simulando o clique durante a janela
    // de debounce (antes de generateReplyFromHistory rodar).
    await prisma.business.update({ where: { id: business.id }, data: { aiGloballyPaused: true } });

    const reply = await generateReplyFromHistory(business.id, phone, phone, "Cliente Teste");
    expect(reply).toBeNull();

    const key = `${business.id}:${phone}`;
    const session = await prisma.chatSession.findUnique({ where: { sessionId: key } });
    expect(session?.needsAttention).toBe(true);
  });
});
