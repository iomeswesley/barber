# Deploy por região (Brasil / Luxemburgo)

O código é o mesmo; **cada região é um deploy próprio, com banco próprio**. Motivos:

- O fuso do processo é único (`process.env.TZ`, ver `src/lib/timezone.ts`) e toda a
  lógica de "hoje", "horário já passou" e janela de lembrete depende dele. Um
  processo só não atende dois fusos.
- **GDPR**: dados de clientes europeus ficam num banco e numa região de
  hospedagem da UE.

## Variáveis que definem a região

| Variável | Brasil (padrão) | Luxemburgo |
|---|---|---|
| `APP_TIMEZONE` | `America/Sao_Paulo` | `Europe/Luxembourg` |
| `APP_DEFAULT_LOCALE` | `pt-BR` | `fr` (ou `en`) |
| `APP_DEFAULT_COUNTRY` | `BR` | `LU` |
| `APP_DEFAULT_CURRENCY` | `BRL` | `EUR` |

Efeitos:
- Negócio novo nasce com `locale/country/currency/timezone` desses valores.
- E-mails, descrição do `.ics`/Google Agenda e `ctz` seguem a região.
- Fora do BR, `/privacidade.html` e `/termos.html` servem as versões GDPR
  (`webroot/privacy-eu.html`, `terms-eu.html`, fr/en no mesmo arquivo).
- Validação de telefone no cadastro exige DDD só no Brasil; fora dele basta o
  número com código do país.

## Checklist pra subir Luxemburgo

1. **Banco na UE**: novo projeto Supabase em região UE (ex: Frankfurt). Rodar
   `npx prisma migrate deploy` apontando `DATABASE_URL`/`DIRECT_URL` pra ele
   (nunca `migrate dev` — ver CLAUDE.md).
2. **Projeto Vercel novo** (ex: `barbearia-saas-eu`) ligado ao mesmo repo, com
   `vercel.eu.json` como config (região `fra1`, cron no horário local
   `0 6 * * *` = 8h CEST/7h CET) — `vercel --local-config vercel.eu.json`.
3. **Env vars**: as 4 da tabela acima + `DATABASE_URL`, `DIRECT_URL`,
   `SESSION_SECRET`, `CRON_SECRET`, `PUBLIC_BASE_URL` (domínio novo) e as demais
   (Anthropic, Meta, Stripe, Resend, ...) — **contas/chaves podem ser as mesmas**,
   mas o webhook da Meta e do Stripe precisam apontar pro domínio novo.
4. **WhatsApp (Meta)**: cada negócio conecta o próprio número (Embedded Signup);
   `createTemplates` cria os templates no idioma do negócio (`fr`/`en`) e a Meta
   aprova por idioma — aprovação leva de minutos a dias, antes disso
   lembrete/reagendamento/reconquista ficam em stub.
5. **Stripe**: criar os preços em EUR (`STRIPE_PRICE_STARTER`/`STRIPE_PRICE_PRO`)
   e ajustar `PLAN_LABELS`/`PLAN_PRICE_CENTS` em `src/lib/stripe.ts` (hoje R$ 99 /
   R$ 149 fixos) — **decisão de preço pendente**. A landing (`index.html`) também
   mostra os preços em R$.
6. **Jurídico**: `privacy-eu.html` e `terms-eu.html` são **rascunhos** com campos
   `[a completar]` (razão social, endereço, contato de privacidade, regiões dos
   fornecedores, prazos de retenção, DPA). Revisão com advogado antes de publicar.
7. **Domínio** próprio (não `*.vercel.app` compartilhado, mesma limitação já
   registrada pro Google OAuth).

## Testar localmente no fuso de outra região

```bash
APP_TIMEZONE=Europe/Luxembourg npx vitest run
```

O `vitest.config.ts` fixa `process.env.TZ` a partir de `APP_TIMEZONE`, então a
suíte inteira roda no fuso da região.
