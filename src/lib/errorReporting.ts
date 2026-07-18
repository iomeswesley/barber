import * as Sentry from "@sentry/node";
import { env } from "@/config/env.js";

// Completamente opcional: sem SENTRY_DSN configurado, todas as funções aqui
// viram no-op — não exige conta de Sentry pra rodar em dev nem em barbearias
// que não configuraram monitoramento.
export const errorReportingEnabled = !!env.SENTRY_DSN;

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
