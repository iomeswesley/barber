# Barbearia SaaS

Reestruturação do [barbearia-bot](../barbearia-bot) como uma base de código profissional, pronta para evoluir para um produto comercializável (SaaS multi-tenant). Esta é uma reescrita de arquitetura — a lógica de negócio foi portada com o mesmo comportamento, não uma reinvenção do produto.

## O que mudou em relação ao barbearia-bot

| | barbearia-bot | barbearia-saas |
|---|---|---|
| Linguagem | JavaScript | TypeScript (strict) |
| Banco | SQLite (`node:sqlite`), 1 arquivo | PostgreSQL via Prisma, migrations versionadas |
| Estrutura | um `db.js` com tudo, `server.js` com todas as rotas | módulos por domínio (`repository` → `service` → `routes`) |
| Sessão | em memória (`express-session` padrão) | Postgres (`connect-pg-simple`) — sobrevive a restart e escala horizontalmente |
| Backup | `VACUUM INTO` (SQLite) | `pg_dump` (requer o cliente Postgres instalado no host) |
| Seed de demonstração | sempre roda se o banco estiver vazio | só roda via `npm run seed`, e só se `SEED_DEMO_DATA=true` |
| Isolamento entre tenants | checagem manual em cada rota | mesma checagem, centralizada em `belongsToSession()` |

Frontend (`webroot/*.html`) foi copiado como está — a reescrita do frontend fica para uma fase seguinte (ver "Próximos passos").

## Arquitetura

```
src/
  config/env.ts        variáveis de ambiente validadas com zod (falha rápido na inicialização)
  lib/                  prisma client, hash de senha, utilitários de data/hora, gerador de .ics
  middleware/            sessão, auth (requireAuth/requireOwner/requireBarber), rate limiting, erros
  modules/<dominio>/
    <dominio>.repository.ts   acesso a dados (Prisma)
    <dominio>.service.ts      regras de negócio (quando há lógica além de CRUD)
    <dominio>.routes.ts       rotas Express
  jobs/                  tarefas de fundo: lembretes (a cada 1 min) e backup (a cada 24h)
  app.ts                 monta o Express (middlewares + todas as rotas)
  server.ts              ponto de entrada (chama createApp() e inicia os schedulers)
prisma/
  schema.prisma          modelo de dados
  seed.ts                dados de demonstração (nunca roda sozinho em produção)
```

Todo modelo que pertence a uma barbearia tem uma coluna `barbershopId` indexada — é a convenção de isolamento entre tenants. `Client` é a única entidade global (identificada pelo telefone, como no WhatsApp); seu vínculo com uma barbearia específica é checado via `clientBelongsToShop()` (existência de algum agendamento), não por uma coluna direta.

## Configurando o ambiente

1. Suba um Postgres (local, Docker, ou um provedor gerenciado como Supabase/Neon/RDS).
   - **Com Supabase**: em Project Settings → Database → Connect → aba "ORM" (Prisma), copie as duas URLs que aparecem lá — uma vai em `DATABASE_URL` (pooler modo transaction, porta 6543) e outra em `DIRECT_URL` (porta 5432). O projeto já está configurado para usar as duas (`directUrl` no `schema.prisma`) — é assim porque o Prisma Migrate, o `pg_dump` do backup e o `connect-pg-simple` da sessão precisam da conexão direta; só as queries da aplicação em si passam pelo pooler.
2. Copie `.env.example` para `.env` e preencha `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET` e as chaves opcionais (IA, push, backup off-site).
3. Instale as dependências e gere o client do Prisma:
   ```
   npm install
   npm run prisma:migrate
   ```
4. (Opcional, só em dev) Semeie dados de demonstração — exige `SEED_DEMO_DATA=true` no `.env`:
   ```
   npm run seed
   ```
5. Rode em modo desenvolvimento (recarrega sozinho ao editar arquivos):
   ```
   npm run dev
   ```

O backup automático (`src/jobs/backup.ts`) chama o binário `pg_dump` — precisa estar instalado e no PATH do host que roda o servidor.

## Login de demonstração

Mesmas credenciais do barbearia-bot original (senha `barbearia123` para todos, gerada pelo seed):
- Dono: `barbearia-vintage.dono`
- Barbeiro: `carlos` (ou `rafael`, `diego`, `lucas`, `bruno`)

## Próximos passos (fora do escopo desta passada)

Esta passada cobriu arquitetura e isolamento de tenant. Ficou de fora, para uma fase seguinte:

1. **Onboarding self-service** — hoje uma barbearia nova só existe via `prisma/seed.ts`; falta uma tela + rota para cadastro de dono/barbearia sem intervenção manual.
2. **Cobrança** — o modelo `Subscription` já está no schema (status trialing/active/past_due/canceled, campos para Stripe) mas sem nenhuma lógica de billing implementada ainda.
3. **LGPD** — política de privacidade e endpoint de exclusão de dados de cliente a pedido.
4. **Reescrita do frontend** — `webroot/*.html` continua em HTML/JS puro, copiado do projeto original; migrar para um framework (ou ao menos modularizar) é uma iniciativa separada.
5. **Auditoria de isolamento nas rotas públicas** — `/api/public/*` e `/api/chat` continuam recebendo `barbershopId` do próprio cliente (sem sessão, já que é o fluxo de WhatsApp/autoatendimento); vale uma revisão de segurança dedicada antes de escalar para múltiplos clientes reais.
