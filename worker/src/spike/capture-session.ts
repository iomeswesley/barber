// Fase 1 — passo 1/2 do spike de viabilidade (ver docs/projeto-ponte.md).
//
// Abre uma janela de navegador DE VERDADE (não headless) na tela de login do
// AppBarber e espera VOCÊ logar manualmente — inclusive resolvendo o
// reCAPTCHA, se ele aparecer. Depois de confirmado, salva a sessão (cookies)
// pra reusar sem precisar logar de novo (ver worker/src/spike/create-appointment.ts).
//
// Importante: este script nunca vê nem manuseia sua senha — você digita
// direto na janela do navegador que ele abre, igual faria manualmente.
//
// Uso: SESSION_SLUG=appbarber-teste npm run capture-session
//   (SESSION_SLUG é opcional, default "appbarber-teste")

import readline from "node:readline/promises";
import { chromium } from "playwright";
import { saveSessionState } from "../session/store.js";

const LOGIN_URL = "https://sistema.appbarber.com.br/login.php";
const slug = process.env.SESSION_SLUG || "appbarber-teste";

async function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(prompt);
  rl.close();
}

async function main() {
  console.log(`\n[capture-session] Abrindo ${LOGIN_URL} numa janela de navegador...`);
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(LOGIN_URL);

  console.log("\n>>> Faça login manualmente na janela que abriu.");
  console.log(">>> Se aparecer o reCAPTCHA, resolva normalmente.");
  console.log(">>> Só volte aqui DEPOIS de estar dentro do painel (WebAdmin) logado.\n");
  await waitForEnter("Pressione ENTER aqui quando já estiver logado dentro do painel... ");

  // Checagem simples: se ainda estiver na URL de login (ou tiver o form de
  // login visível), o login provavelmente não terminou — avisa mas ainda
  // assim tenta salvar (o humano pode confirmar e tentar de novo se falhar).
  const stillOnLogin = page.url().includes("login.php");
  if (stillOnLogin) {
    console.log("\n[capture-session] Aviso: a URL ainda parece ser a de login. Confirma que o painel carregou antes de continuar.");
  }

  const storageState = await context.storageState();
  const savedTo = await saveSessionState(slug, storageState);
  console.log(`\n[capture-session] Sessão salva em: ${savedTo}`);
  console.log(`[capture-session] URL final capturada: ${page.url()}`);

  await browser.close();
}

main().catch((err) => {
  console.error("[capture-session] Falhou:", err);
  process.exit(1);
});
