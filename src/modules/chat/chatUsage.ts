import { prisma } from "@/lib/prisma.js";
import type Anthropic from "@anthropic-ai/sdk";

// Fire-and-forget: telemetria de custo não deve atrasar nem quebrar a
// resposta ao cliente se o insert falhar.
export function logChatUsage(barbershopId: number, model: string, usage: Anthropic.Usage): void {
  prisma.chatUsageLog
    .create({
      data: {
        barbershopId,
        model,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
      },
    })
    .catch((err) => console.error("[CHAT USAGE] Falha ao gravar log de uso:", (err as Error).message));
}
