// Relatório de custo real do bot de WhatsApp (Anthropic), por barbearia, a
// partir do log gravado em ChatUsageLog (ver src/modules/chat/chatUsage.ts).
// Preço fixo pro claude-sonnet-5 abaixo — atualizar se o modelo ou o preço
// promocional (vigente até 2026-08-31) mudar.
//
// Uso: npx tsx --env-file=.env scripts/chat-usage-report.ts [--days=30]
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// USD por token (preço promocional do claude-sonnet-5, vigente até 2026-08-31).
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

    const name = nameById.get(log.businessId) ?? `#${log.businessId}`;
    console.log(
      `${name}: ${log._count} chamadas, ${input + cacheWrite + cacheRead} tokens de entrada, ${output} de saída — US$ ${cost.toFixed(4)}`
    );
  }

  console.log(`\nTotal: US$ ${totalCost.toFixed(2)}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
