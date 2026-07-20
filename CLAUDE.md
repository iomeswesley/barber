# Contexto do projeto — barbearia-saas

Leia isto no início de qualquer sessão nova. Arquitetura detalhada está no [README.md](README.md) — aqui é o estado atual e as convenções operacionais que não estão lá.

## O que é

SaaS multi-tenant de agendamento para barbearias: painel web (dono/barbeiro) + bot de WhatsApp com IA (Anthropic) fazendo o autoatendimento do cliente final. Reescrita profissional (TS/Postgres/Prisma) de um protótipo anterior (`barbearia-bot`, outro diretório, mantido só como referência histórica — não misturar convenções).

- Repo: github.com/iomeswesley/barber, branch `master` (sem branches de feature)
- Deploy: Vercel, produção em https://barbearia-saas-jet.vercel.app
- Banco: Postgres via Supabase (Prisma) — **um único banco, sem staging/teste separado**. Dev local aponta pro mesmo banco de produção.

## Convenções operacionais (importante seguir)

- **Antes de qualquer commit**: `npx tsc --noEmit` e `npx vitest run` têm que passar limpos.
- **Depois de qualquer mudança validada, dar `git push origin master` sem perguntar** — instrução explícita do usuário (2026-07-20): "sempre que fizer algo já manda pra nuvem". Vale para commits normais; ações destrutivas (force push, reset, etc.) continuam exigindo confirmação.
- **Depois do push**, o Vercel às vezes não promove o deployment novo pra produção sozinho — avisar o usuário que pode ser preciso ir em Deployments → "Promote to Production" manualmente (não temos acesso ao dashboard do Vercel pra fazer isso).
- **Migrations do Prisma**: nunca rodar `prisma migrate dev` direto — ele detecta "drift" por causa da tabela `session` (criada em runtime pelo `connect-pg-simple`, fora do controle de migrations do Prisma) e tenta oferecer um **reset completo do banco de produção**. Sempre criar a pasta de migration manualmente (copiando o padrão de `prisma/migrations/*/migration.sql`) e aplicar com `npx prisma migrate deploy`, que só aplica migrations pendentes sem checar drift.
- **Testes de integração** usam o banco real — sempre prefixar dados de teste com `[teste]` e limpar no `afterAll` (ver `src/modules/appointments/appointments.service.test.ts` como modelo). Nunca rodar ações reais (reset de senha, cobrança, envio de WhatsApp) contra contas de clientes de verdade — criar um registro `[teste]` descartável, validar, apagar.

## Status (última atualização: 2026-07-20)

Tudo abaixo já está implementado e em produção — o README pode estar desatualizado em relação a isso, checar o código antes de assumir que algo é "próximo passo":

- Onboarding self-service, LGPD (privacidade/termos/exclusão), Sentry, headers de segurança (helmet), recuperação de senha, cobrança via Stripe (Starter/Pro).
- WhatsApp Cloud API oficial da Meta (não Baileys) — `src/lib/whatsapp.ts` + `src/modules/whatsapp/`, com Message Templates aprovados pra lembrete/reagendamento/reconquista.
- Landing page de marketing na raiz do site (redesign dark glassmorphism dourado).
- **Painel de super-admin da plataforma** (`/superadmin.html`): lista todos os usuários de todas as barbearias e permite gerar senha aleatória + mandar por e-mail. Login pela mesma tela/rota de dono/barbeiro (`/login.html` → `POST /api/auth/login`), que reconhece as credenciais fixas via env (`ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH`, não uma conta na tabela `users`) antes de cair na busca normal. Ver `src/modules/superadmin/`.
- Auditoria de segurança rodada e corrigida: IDOR entre tenants no agendamento público (barbeiro/serviço de uma barbearia não podem mais ser usados pra criar agendamento em outra) e fail-closed no webhook do WhatsApp (antes aceitava requisição sem assinatura se `WHATSAPP_APP_SECRET` sumisse).

### Pendências reais

1. Reescrita do frontend (`webroot/*.html` continua HTML/JS puro, não framework).
2. Cobertura de testes concentrada em `lib/`, `clients` e `appointments` — faltam testes pra `billing` (webhook Stripe), `whatsapp`/`chat`, `onboarding`/`auth` e o painel de super-admin.
3. Exclusão LGPD é global entre barbearias (por `Client` ser entidade compartilhada por telefone) — decisão de arquitetura documentada, não bug; revisitar se virar problema real.
4. Rotas públicas de autoatendimento (`/api/public/*`, `/api/chat`) confiam só no telefone como identidade, sem OTP — mitigado por rate limit, não eliminado.

## Login de demonstração

Senha `barbearia123` para todos. Dono: `barbearia-vintage.dono` ou `barber-king.dono`. Barbeiro: `carlos`, `rafael`, `diego`, `lucas` ou `bruno`.

Super-admin: usuário `admin`, senha configurada via `ADMIN_PASSWORD_HASH` no `.env`/Vercel (gerar com `npx tsx scripts/hash-password.ts <senha>`).
