import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Guarda o storageState do Playwright (cookies + localStorage da sessão já
// logada) por "slug" — hoje só um valor fixo pra conta de teste da Fase 1
// (spike), mas o formato já pensa em virar 1 arquivo por barbearia quando
// isso passar pra produção (Fase 2), guardado então criptografado no banco
// em vez de em disco (mesmo padrão de src/lib/crypto.ts no app principal).
//
// NUNCA versionar o conteúdo dessa pasta — um arquivo aqui equivale a uma
// sessão já autenticada (mesmo risco que vazar a senha em si). Ver
// worker/.gitignore.
const SESSIONS_DIR = path.resolve(import.meta.dirname, "../../.sessions");

function sessionPath(slug: string): string {
  return path.join(SESSIONS_DIR, `${slug}.json`);
}

export async function saveSessionState(slug: string, storageState: unknown): Promise<string> {
  await mkdir(SESSIONS_DIR, { recursive: true });
  const file = sessionPath(slug);
  await writeFile(file, JSON.stringify(storageState, null, 2), "utf8");
  return file;
}

export async function loadSessionState(slug: string): Promise<unknown> {
  const raw = await readFile(sessionPath(slug), "utf8");
  return JSON.parse(raw);
}

export async function hasSessionState(slug: string): Promise<boolean> {
  try {
    await readFile(sessionPath(slug), "utf8");
    return true;
  } catch {
    return false;
  }
}
