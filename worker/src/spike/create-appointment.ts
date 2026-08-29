// Fase 1 — passo 2/2 do spike de viabilidade (ver docs/projeto-ponte.md).
//
// Prova a parte que realmente importa: reusar a sessão salva por
// capture-session.ts pra fazer uma ação dentro do AppBarber SEM passar pelo
// login de novo (e portanto sem tocar no reCAPTCHA) — headless, do jeito que
// o worker de produção vai rodar de verdade.
//
// Hoje este script só confirma que a sessão salva é válida (chega numa
// página autenticada sem cair de volta no login) e tira um screenshot. A
// criação de agendamento em si está marcada como TODO abaixo porque ainda
// não vimos a tela autenticada do WebAdmin — depois de rodar capture-session
// uma vez, o jeito mais rápido de descobrir os seletores reais é:
//
//   npx playwright codegen --load-storage=../.sessions/appbarber-teste.json https://sistema.appbarber.com.br
//
// (gera código Playwright automaticamente enquanto você clica manualmente
// no fluxo de criar agendamento — copia os seletores de lá pra cá.)
//
// Uso: SESSION_SLUG=appbarber-teste npm run spike:create-appointment

import { chromium, type BrowserContextOptions } from "playwright";
import { hasSessionState, loadSessionState } from "../session/store.js";

const BASE_URL = "https://sistema.appbarber.com.br";
const slug = process.env.SESSION_SLUG || "appbarber-teste";

async function main() {
  if (!(await hasSessionState(slug))) {
    console.error(`[create-appointment] Nenhuma sessão salva em .sessions/${slug}.json — rode "npm run capture-session" primeiro.`);
    process.exit(1);
  }

  const storageState = (await loadSessionState(slug)) as BrowserContextOptions["storageState"];

  console.log("[create-appointment] Abrindo headless, reusando a sessão salva (sem login)...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();

  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");

  const landedOnLogin = page.url().includes("login.php");
  const screenshotPath = `./.sessions/${slug}-landing.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });

  if (landedOnLogin) {
    console.error(
      `[create-appointment] A sessão salva não é mais válida (caiu de volta na tela de login: ${page.url()}). ` +
        `Rode "npm run capture-session" de novo. Screenshot salvo em ${screenshotPath} pra conferir.`
    );
    await browser.close();
    process.exit(1);
  }

  console.log(`[create-appointment] Sessão válida! Chegou autenticado em: ${page.url()}`);
  console.log(`[create-appointment] Screenshot salvo em ${screenshotPath} — confirma visualmente que é o painel logado.`);

  // TODO (depois de ver a tela real, via playwright codegen — ver comentário
  // no topo do arquivo): navegar até a agenda, abrir "novo agendamento",
  // preencher cliente/serviço/profissional/horário e confirmar. Ex (ajustar
  // seletores reais):
  //
  // await page.getByRole("link", { name: /agenda/i }).click();
  // await page.getByRole("button", { name: /novo agendamento/i }).click();
  // await page.getByLabel(/cliente/i).fill("[teste] Cliente Ponte");
  // ...
  // await page.getByRole("button", { name: /salvar|confirmar/i }).click();

  await browser.close();
}

main().catch((err) => {
  console.error("[create-appointment] Falhou:", err);
  process.exit(1);
});
