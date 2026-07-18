import { defineConfig } from "vitest/config";
import path from "node:path";

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
