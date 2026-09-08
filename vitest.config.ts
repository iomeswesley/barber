import { defineConfig } from "vitest/config";
import path from "node:path";

// Carrega o .env pro processo de teste igual os scripts (`tsx --env-file=.env`)
// e o dev server (`tsx watch --env-file=.env`) — sem isso, rodar um arquivo de
// teste isolado (`vitest run src/foo.test.ts`) falha com "DATABASE_URL:
// Required" mesmo tendo passado com o suite inteiro antes (efeito de cache/
// ordem de import entre arquivos, não confiável). try/catch: em CI o .env não
// existe, as env vars reais vêm do ambiente mesmo.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, ".env"));
} catch {
  // sem .env local (ex: CI) — segue com o que já estiver em process.env
}

// Alias "@/*" -> "src/*", igual ao paths do tsconfig.json — sem isso, os
// testes não conseguem resolver os mesmos imports "@/lib/..." usados no
// resto do código-fonte.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    // Todo teste HTTP roda contra o banco ÚNICO de produção (sem staging,
    // ver CLAUDE.md) — cada arquivo cria seu próprio Express app com
    // sessão própria (connect-pg-simple) e bate no mesmo Postgres. Achado
    // em 08/09, na migração pro vitest 4: o paralelismo padrão entre
    // arquivos ficou agressivo o bastante pra gerar flakiness real (dois
    // arquivos com telefone "único" gerado por Date.now() colidindo no
    // mesmo milissegundo, sessão de um teste vazando 401 sobre outro sob
    // concorrência) — antes não dava pra perceber com o paralelismo mais
    // brando do vitest 2. fileParallelism: false roda os arquivos em série,
    // exatamente o caso de uso documentado pelo próprio vitest pra "recurso
    // externo compartilhado que não aguenta acesso concorrente".
    fileParallelism: false,
  },
});
