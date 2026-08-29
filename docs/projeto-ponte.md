# Projeto Ponte — extensão de WhatsApp em cima de sistemas de agenda de terceiros

> Plano completo (com diagramas) publicado como artifact: peça o link se precisar, ou veja o resumo abaixo.
> Este arquivo é a referência durável no repo — atualizar aqui conforme o projeto avança.

## Contexto

Cliente da barbearia atual usa o AppBarber e não quer trocar (é vitrine dele pra clientes novos). Pediu uma
"extensão" que só faça o atendimento/agendamento via WhatsApp com IA, plugada em cima do AppBarber — sem
substituir o app que ele já usa.

## Diagnóstico (2026-08-29)

- **AppBarber**: plataforma fechada. Sem API pública, sem webhook, sem programa de parceiros documentado.
  Contato pra parceria: `atendimento@appbarber.com.br` (via chat comercial, sem doc técnica pública).
- **Trinks** (concorrente direto): tem API pública + webhooks ("Conecta Trinks"), cita "agendamento via
  chatbot" como caso de uso oficial — valida o modelo de negócio, só não vale pro AppBarber especificamente.
- **Achado crítico (spike inicial)**: a página de login do AppBarber (`sistema.appbarber.com.br/login.php`)
  tem reCAPTCHA invisível da Google (`size=invisible`, sitekey `6LdVO78a...`). Login automatizado repetido
  corre risco real de ser bloqueado/desafiado — decisão tomada: **não tentar vencer o captcha** (nem via
  serviço de resolução — seria burlar proteção anti-abuso de terceiro, fora de cogitação).

## Direção técnica confirmada

1. **Automação completa do dia a dia** (criar/cancelar/remarcar agendamento) via RPA (Playwright), rodando
   num worker separado — nunca em função serverless da Vercel (Chromium headless não cabe no runtime/tempo
   de execução de uma function).
2. **Sessão persistente, sem repetir login automatizado**: o dono/barbeiro loga manualmente UMA vez
   (passa pelo captcha ele mesmo) — o worker captura e guarda a sessão (cookies) daquele login e reusa pra
   todas as ações seguintes. Login de novo só quando a sessão expirar, e nesse caso cai pra "precisa de
   atenção humana" em vez de tentar logar sozinho.
3. **Arquitetura em adaptador**: o núcleo de IA do WhatsApp fala com uma interface comum de "Provedor de
   Agenda" — cada sistema de terceiro (AppBarber via RPA, Trinks via API no futuro) implementa essa interface
   à sua maneira. Mesmo princípio já usado hoje pro Google Agenda (`src/lib/googleCalendar.ts`).

## Roteiro

| Fase | O quê | Depende de |
|---|---|---|
| 0 | Consentimento do cliente sobre o risco (jurídico/comercial) | — |
| 1 | Spike: capturar sessão manualmente + provar que uma ação (criar agendamento) funciona headless reusando a sessão | conta de teste real do AppBarber |
| 2 | Worker de produção: fila de jobs, cofre de credenciais/sessão criptografado, alerta de quebra de seletor | Fase 1 validada |
| 3 | Sincronização de leitura (poll do calendário do AppBarber, evita agendamento duplicado) | Fase 2 |
| 4 | Generalizar em "Provedor de Agenda" plugável (Trinks via API como 2º adaptador) | Fase 2/3 |
| 5 | Reposicionar comercialmente: SKU "Extensão", mais barato que o SaaS completo | Fase 4 |

## Onde mora o código

`worker/` na raiz do repo — pasta própria com `package.json`/`tsconfig.json` independentes do app principal:
- Compartilha o mesmo Postgres (schema único, `prisma/schema.prisma`) — sem duplicar modelo de dados.
- Fica automaticamente fora do build da Vercel (que só builda `api/index.js`) — não precisa de config extra
  pra isolar o Playwright/Chromium do bundle serverless.
- Tem checagem de tipo própria (`npm run typecheck` dentro de `worker/`) — importante não deixar isso de fora
  do hábito de checar antes de commit, mesma lição já aprendida com `scripts/*.ts` fora do `tsconfig.json`
  principal (ver CLAUDE.md, seção "Motor único").

## Status

- [x] Diagnóstico de viabilidade (AppBarber fechado, achado do reCAPTCHA)
- [x] Decisão de arquitetura (sessão persistente, adaptador RPA)
- [x] Esqueleto do `worker/` criado (Fase 1)
- [ ] Spike validado contra conta de teste real (depende de alguém rodar `capture-session` + `spike:create-appointment` manualmente)
- [ ] Fase 2 em diante
