import { defineConfig } from "vitest/config";
import path from "node:path";

// Carrega o .env pro processo de teste igual os scripts (`tsx --env-file=.env`)
// e o dev server (`tsx watch --env-file=.env`) — sem isso, rodar um arquivo de
// teste isolado (`vitest run src/foo.test.ts`) falha com "DATABASE_URL:
// Required" mesmo tendo passado com o suite inteiro antes (efeito de cache/
// ordem de import entre arquivos, não confiável). try/catch: em CI o .env não
// existe, as env vars reais vêm do ambiente mesmo.
try {
  process.loadEnvFile(path.resolve(__dirname, ".env"));
} catch {
  // sem .env local (ex: CI) — segue com o que já estiver em process.env
}

// Alias "@/*" -> "src/*", igual ao paths do tsconfig.json — sem isso, os
// testes não conseguem resolver os mesmos imports "@/lib/..." usados no
// resto do código-fonte.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
  },
});
