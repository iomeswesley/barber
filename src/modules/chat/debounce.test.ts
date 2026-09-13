import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma.js";
import { recordIncomingMessage, hasNewerCustomerMessage } from "./chatEngine.js";

// Cobre a metade do debounce de resposta (ver whatsapp.routes.ts) que roda
// em cima do banco de verdade: recordIncomingMessage grava a mensagem e o
// "ticket" (lastCustomerMessageAt), hasNewerCustomerMessage é quem o
// webhook consulta durante a espera pra saber se deve desistir. A parte de
// "esperar 20s de silêncio" em si já é coberta nos testes HTTP do webhook
// (mockada, sem timer real) — aqui é só a leitura/escrita no chat_sessions.
describe("recordIncomingMessage / hasNewerCustomerMessage (debounce de resposta)", () => {
  let business: { id: number };
  const sessionId = `teste-debounce-${Date.now()}`;
  const phone = `55119${Date.now().toString().slice(-8)}`;

  beforeAll(async () => {
    business = await prisma.business.create({ data: { name: "[teste] Debounce Resposta" } });
  });

  afterAll(async () => {
    await prisma.chatSession.deleteMany({ where: { businessId: business.id } });
    await prisma.business.deleteMany({ where: { id: business.id } });
  });

  it("grava a mensagem, marca lastCustomerMessageAt e devolve status 'queued'", async () => {
    const result = await recordIncomingMessage(business.id, sessionId, "Oi, quero marcar um horário", phone);
    expect(result.status).toBe("queued");

    const session = await prisma.chatSession.findUnique({ where: { sessionId: `${business.id}:${sessionId}` } });
    expect(session?.lastCustomerMessageAt).toBeTruthy();
    const messages = session?.messages as unknown as { role: string; content: unknown }[];
    expect(messages.at(-1)).toEqual({ role: "user", content: "Oi, quero marcar um horário" });
  });

  it("hasNewerCustomerMessage: false pra um 'since' igual ou depois do último registrado", async () => {
    const recorded = await recordIncomingMessage(business.id, sessionId, "amanhã de tarde", phone);
    if (recorded.status !== "queued") throw new Error("esperava 'queued'");

    expect(await hasNewerCustomerMessage(business.id, sessionId, recorded.queuedAt)).toBe(false);
  });

  it("hasNewerCustomerMessage: true quando uma mensagem mais nova chegou depois do 'since'", async () => {
    const first = await recordIncomingMessage(business.id, sessionId, "primeira mensagem da rajada", phone);
    if (first.status !== "queued") throw new Error("esperava 'queued'");

    // Espera alguns ms pra garantir um timestamp estritamente maior — sem
    // isso, as duas mensagens poderiam cair no mesmo milissegundo (o
    // clock_timestamp() da coluna tem só resolução de ms) e o teste ficaria
    // instável dependendo da velocidade da máquina.
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Segunda mensagem chega "logo em seguida" (mesma sessão, telefone) —
    // simula o cliente mandando duas mensagens em sequência rápida.
    await recordIncomingMessage(business.id, sessionId, "segunda mensagem da rajada", phone);

    expect(await hasNewerCustomerMessage(business.id, sessionId, first.queuedAt)).toBe(true);
  });

  it("hasNewerCustomerMessage: false pra uma sessão que não existe", async () => {
    expect(await hasNewerCustomerMessage(business.id, "sessao-inexistente-123", new Date())).toBe(false);
  });
});
