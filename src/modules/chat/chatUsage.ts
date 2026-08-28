import { prisma } from "@/lib/prisma.js";
import type Anthropic from "@anthropic-ai/sdk";

// Nunca lança (erro só é logado) e nunca bloqueia o fluxo do bot em si —
// mas precisa ser aguardado pelo chamador: em função serverless a Promise
// pode ser congelada assim que a resposta HTTP sai, matando o insert antes
// de terminar (mesmo bug do fire-and-forget do Google Agenda, 2026-08-23).
export async function logChatUsage(businessId: number, model: string, usage: Anthropic.Usage): Promise<void> {
  await prisma.chatUsageLog
    .create({
      data: {
        businessId,
        model,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
      },
    })
    .catch((err) => console.error("[CHAT USAGE] Falha ao gravar log de uso:", (err as Error).message));
}
