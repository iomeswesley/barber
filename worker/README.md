# worker — automação de sistemas de agenda sem API (Projeto Ponte)

Serviço separado do app principal (`../src`), pensado pra rodar fora da Vercel (VPS/Railway/Fly.io) porque
depende de um navegador headless (Playwright) — algo que não cabe no runtime de uma função serverless.
Contexto completo e roteiro de fases em [`../docs/projeto-ponte.md`](../docs/projeto-ponte.md).

## Fase 1 — spike de viabilidade (onde estamos agora)

Objetivo único: provar que dá pra automatizar uma ação real dentro do AppBarber **sem tocar no login
automatizado** (a tela de login tem reCAPTCHA — decisão tomada de não tentar contornar isso, ver
`docs/projeto-ponte.md`). A saída é sessão persistente: um humano loga manualmente uma vez, o worker reusa
essa sessão.

### Setup

```bash
cd worker
npm install
npm run playwright:install   # baixa o Chromium do Playwright (~300MB, só na primeira vez)
```

### Passo 1 — capturar uma sessão logada

Roda numa conta de **teste** do AppBarber (nunca a conta real de um cliente):

```bash
npm run capture-session
```

Abre uma janela de navegador de verdade. Você loga manualmente ali (inclusive resolvendo o captcha, se
aparecer) e depois volta pro terminal e aperta ENTER. O script salva a sessão em `worker/.sessions/` —
**esse arquivo equivale a estar logado**, nunca commitar (já está no `.gitignore` do worker).

### Passo 2 — provar que a automação funciona sem repetir o login

```bash
npm run spike:create-appointment
```

Abre headless, carrega a sessão salva, confirma que chega autenticado (sem cair de volta na tela de login)
e tira um screenshot em `worker/.sessions/`. A parte de criar o agendamento em si ainda está marcada como
`TODO` no arquivo — depois de rodar o passo 1, o jeito mais rápido de descobrir os seletores reais da tela
autenticada é gerar código automaticamente enquanto você clica no fluxo manualmente:

```bash
npx playwright codegen --load-storage=.sessions/appbarber-teste.json https://sistema.appbarber.com.br
```

### O que essa fase NÃO cobre ainda (fica pra Fase 2)

- Cofre de credenciais/sessão por barbearia no banco (hoje é um arquivo local, só pra validar o spike).
- Fila de jobs, retries, alerta de quebra de seletor.
- Sincronização de leitura (evitar agendamento duplicado).

## Comandos

| Comando | O que faz |
|---|---|
| `npm run typecheck` | `tsc --noEmit` — roda igual ao `npm run typecheck` do app principal, mas separado (ver nota abaixo) |
| `npm run playwright:install` | Baixa o binário do Chromium usado pelo Playwright |
| `npm run capture-session` | Login manual + salva a sessão |
| `npm run spike:create-appointment` | Reusa a sessão salva, headless |

**Importante**: `npx tsc --noEmit` na raiz do repo **não cobre esta pasta** (tsconfig raiz só inclui
`src/**/*.ts`) — rodar `npm run typecheck` aqui dentro também antes de commitar mudanças no worker, senão
cai na mesma armadilha que os `scripts/*.ts` do app principal já caíram uma vez (ver CLAUDE.md).
