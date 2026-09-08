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
    // captureError (abaixo) manda uma descrição legível em extra.descricao —
    // prefixa ela na mensagem da exceção principal, então o título do
    // issue/assunto do alerta já diz o que aconteceu (rota, barbearia, etc.)
    // em vez de só "TypeError: Cannot read properties of undefined...".
    // Roda no cliente antes de mandar o evento — não interfere no
    // agrupamento (a Sentry calcula o fingerprint a partir dos frames do
    // stack trace do lado do servidor, depois disso), só muda o que é
    // exibido.
    beforeSend(event) {
      const descricao = event.extra?.descricao;
      const principal = event.exception?.values?.[0];
      if (typeof descricao === "string" && principal) {
        principal.value = `${descricao} — ${principal.value ?? ""}`;
      }
      return event;
    },
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

// `context` é opcional — sem ele, funciona igual antes (só captura a
// exceção crua). Com ele, anexa uma descrição legível (`descricao`, vira o
// prefixo do título via beforeSend acima), um `area` (tag, dá pra filtrar
// issues por origem no Sentry) e qualquer dado estruturado extra (ex:
// businessId) que ajude a entender o que estava rolando sem precisar
// vasculhar o stack trace.
export function captureError(
  err: unknown,
  context?: { descricao: string; area?: string; extra?: Record<string, unknown> }
) {
  if (!errorReportingEnabled) return;
  if (!context) {
    Sentry.captureException(err);
    return;
  }
  Sentry.captureException(err, {
    tags: context.area ? { area: context.area } : undefined,
    extra: { descricao: context.descricao, ...context.extra },
  });
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
