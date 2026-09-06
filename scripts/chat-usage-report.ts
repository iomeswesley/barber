// Relatório de custo real do bot de WhatsApp (Anthropic), por barbearia, a
// partir do log gravado em ChatUsageLog (ver src/modules/chat/chatUsage.ts).
// Preço fixo pro claude-sonnet-5 abaixo — atualizar se o modelo ou a tabela
// de preço oficial da Anthropic mudar (conferir https://claude.com/pricing).
//
// Uso: npx tsx --env-file=.env scripts/chat-usage-report.ts [--days=30]
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// USD por token (tabela oficial do claude-sonnet-5, confirmada em 2026-09-06 —
// não é mais promocional, é o preço padrão vigente do modelo).
const PRICE_INPUT = 2.0 / 1_000_000;
const PRICE_OUTPUT = 10.0 / 1_000_000;
const PRICE_CACHE_WRITE = PRICE_INPUT * 1.25;
const PRICE_CACHE_READ = PRICE_INPUT * 0.1;

function parseDaysArg(): number {
  const arg = process.argv.find((a) => a.startsWith("--days="));
  return arg ? Number(arg.split("=")[1]) : 30;
}

async function main() {
  const days = parseDaysArg();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const logs = await prisma.chatUsageLog.groupBy({
    by: ["businessId"],
    where: { createdAt: { gte: since } },
    _sum: {
      inputTokens: true,
      outputTokens: true,
      cacheCreationInputTokens: true,
      cacheReadInputTokens: true,
    },
    _count: true,
  });

  if (logs.length === 0) {
    console.log(`Nenhum uso registrado nos últimos ${days} dias.`);
    return;
  }

  const businesses = await prisma.business.findMany({
    where: { id: { in: logs.map((l) => l.businessId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(businesses.map((b) => [b.id, b.name]));

  console.log(`\nUso do bot de WhatsApp — últimos ${days} dias\n`);

  let totalCost = 0;
  for (const log of logs) {
    const input = log._sum.inputTokens ?? 0;
    const output = log._sum.outputTokens ?? 0;
    const cacheWrite = log._sum.cacheCreationInputTokens ?? 0;
    const cacheRead = log._sum.cacheReadInputTokens ?? 0;

    const cost =
      input * PRICE_INPUT + output * PRICE_OUTPUT + cacheWrite * PRICE_CACHE_WRITE + cacheRead * PRICE_CACHE_READ;
    totalCost += cost;

    // Proxy de "conversas" no período: sessões (telefones) que tiveram
    // atividade na janela — ChatUsageLog não guarda sessionId, então não dá
    // pra saber com exatidão quantas chamadas pertencem a qual conversa. Uma
    // sessão que teve atividade fora da janela mas só 1 chamada dentro dela
    // conta como 1 conversa aqui, então é aproximação, não exato.
    const sessionCount = await prisma.chatSession.count({
      where: { businessId: log.businessId, updatedAt: { gte: since } },
    });

    const name = nameById.get(log.businessId) ?? `#${log.businessId}`;
    const avgPerCall = cost / log._count;
    const avgPerConversation = sessionCount > 0 ? cost / sessionCount : null;
    console.log(
      `${name}: ${log._count} chamadas em ${sessionCount} conversas, ${input + cacheWrite + cacheRead} tokens de entrada, ${output} de saída — ` +
        `US$ ${cost.toFixed(4)} (US$ ${avgPerCall.toFixed(6)}/chamada` +
        (avgPerConversation !== null ? `, US$ ${avgPerConversation.toFixed(4)}/conversa)` : ")")
    );
  }

  const totalCalls = logs.reduce((sum, l) => sum + l._count, 0);
  console.log(`\nTotal: US$ ${totalCost.toFixed(2)} em ${totalCalls} chamadas — US$ ${(totalCost / totalCalls).toFixed(6)}/chamada em média\n`);
  console.log(
    "Nota: \"conversa\" aqui é aproximado (conta de ChatSession/telefone com atividade na janela, não um\n" +
      "sessionId gravado por chamada em ChatUsageLog) — uma sessão ativa parcialmente fora da janela pesa\n" +
      "menos do que devia no cálculo. Pra ficar exato precisaria gravar sessionId em ChatUsageLog."
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
