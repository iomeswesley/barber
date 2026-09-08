import * as Sentry from "@sentry/node";
import { env } from "@/config/env.js";

// Completamente opcional: sem SENTRY_DSN configurado, todas as funções aqui
// viram no-op — não exige conta de Sentry pra rodar em dev nem em barbearias
// que não configuraram monitoramento.
//
// Achado em produção (2026-09-08): testes que exercitam de propósito um
// caminho de erro (assinatura de webhook inválida, evento sem businessId
// etc. — ver billing.routes.test.ts) chamam captureError de verdade e
// disparam alerta real no Sentry a cada `vitest run`, mesmo sendo o
// comportamento esperado do teste. NODE_ENV não serve de guarda aqui — o
// .env do projeto fixa NODE_ENV=development (não "test"), e o
// vitest.config.ts carrega esse .env antes de qualquer teste rodar. Usa o
// marcador que o próprio Vitest define de verdade (process.env.VITEST),
// confiável independente do que o .env disser.
export const errorReportingEnabled = !!env.SENTRY_DSN && !process.env.VITEST;

if (errorReportingEnabled) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    // Sem tracing de performance — só captura de erro, que é o que falta hoje
    // (descobrir bug em produção só quando o cliente reclama).
    tracesSampleRate: 0,
  });

  // Erros que escapam de qualquer try/catch (bug de verdade, não AppError
  // esperado) — sem isso, um throw fora de uma rota Express simplesmente
  // derruba a instância sem deixar rastro nenhum.
  process.on("uncaughtException", (err) => {
    console.error("[UNCAUGHT EXCEPTION]", err);
    Sentry.captureException(err);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[UNHANDLED REJECTION]", reason);
    Sentry.captureException(reason);
  });
}

export function captureError(err: unknown) {
  if (!errorReportingEnabled) return;
  Sentry.captureException(err);
}

// Em serverless (Vercel), o processo pode congelar assim que a resposta HTTP
// termina — sem esperar o flush, o evento capturado às vezes nem chega a
// sair pela rede antes disso acontecer.
export async function flushErrorReporting() {
  if (!errorReportingEnabled) return;
  try {
    await Sentry.flush(2000);
  } catch {
    // Uma falha no flush do Sentry não pode derrubar a resposta ao cliente.
  }
}
