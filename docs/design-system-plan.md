# Plano: unificar o design system "dark glassmorphism dourado" em todo o projeto

Status: plano apenas — nada foi implementado. Preparado para execução numa sessão futura.

## Contexto (descoberto ao auditar o código, não assumido)

O projeto **não é React/Tailwind** — é HTML/CSS/JS puro servido estático de `webroot/`
(`src/app.ts:91` → `express.static(webroot)`). A referência do Pro Tennis (React+Tailwind)
serve de inspiração estética, mas a implementação técnica aqui precisa ser traduzida pra
CSS custom properties + classes utilitárias simples, sem introduzir um pipeline de build
(Tailwind) numa app de 5 páginas vanilla — seria desproporcional ao ganho.

**Descoberta importante: o sistema já existe, só está fragmentado.** `webroot/admin.html`
já implementa quase 100% do que foi pedido — tokens RGB triplet, tema claro/escuro via
`[data-theme]`, cartões glass, blobs decorativos animados, modal customizado (substitui
`confirm()`/`alert()`), scrollbar fina. **`admin.html` é a referência canônica**, não algo a
recriar do zero. O problema é que cada página duplica sua própria cópia (parcial, e já
divergente) desses tokens inline, em vez de compartilhar uma fonte única.

## Auditoria por página

| Página | Tokens (`--color-*`) | Toggle claro/escuro | Blobs | Modal customizado | Scrollbar fina | Observação |
|---|---|---|---|---|---|---|
| `admin.html` | ✅ completo (referência) | ✅ | ✅ | ✅ | ✅ | Cartões têm hover? só confirmado em `.btn-danger`; falta checar `.card:hover` "respirando" |
| `barber.html` | ✅ (cópia própria, já ligeiramente divergente) | ✅ | ❌ ausente | ❌ usa `confirm()`/`alert()` nativos em 4 lugares (linhas 424, 428, 463, 666, 674, 722) | ❌ | Maior gap de comportamento (nativo bloqueia a UI, quebra a identidade visual) |
| `login.html` | ⚠️ set próprio, nomes diferentes (`--gold`, `--card-bg` soltos, sem RGB triplet) | ❌ ausente | ✅ (implementação própria) | — (não há ações destrutivas nessa tela) | — | Pré-login: decidir se vale ter toggle de tema aqui (ver "Decisões em aberto") |
| `minha-conta.html` | ⚠️ parcial | não confirmado | ✅ | ❌ usa `confirm()` nativo (linha 158) | não confirmado | Precisa auditoria linha a linha na execução |
| `chat.html` | N/A | N/A | N/A | N/A | N/A | **Fora de escopo** — é um simulador de WhatsApp (paleta verde/branco proposital, mimetiza o app real pra testar o bot). Aplicar o dourado aqui quebraria o propósito da tela. |

## Decisão de arquitetura: extrair para arquivos compartilhados

Hoje cada HTML tem um bloco `<style>` inline de ~200-800 linhas com tokens duplicados.
Isso é a causa raiz do drift entre páginas. Proposta:

- **`webroot/assets/theme.css`** — tokens (`:root` + `[data-theme="light"]`), tipografia
  base (Inter/Sora, `letter-spacing` em headings), `.bg-dark-card` (glass reforçado via
  classe, não só utility), hover "respirando" em cartões, sistema de blobs decorativos +
  vinheta, scrollbar fina, CSS do modal customizado.
- **`webroot/assets/modal.js`** — helper JS reutilizável (`showConfirm()`, `showAlert()`)
  extraído da implementação já existente em `admin.html` (linhas ~639 e ~1195), renderizado
  via portal (`document.body`), pra substituir todo `confirm()`/`alert()` nativo.
- Cada página passa a linkar `<link rel="stylesheet" href="/assets/theme.css">` e
  `<script src="/assets/modal.js"></script>`, e mantém no `<style>` inline **só** o CSS
  específico daquela tela (layout de grid, componentes únicos).

**Cuidado de especificidade:** o `theme.css` deve ser carregado *antes* do `<style>` inline
de cada página, pra que overrides locais (se necessários) vençam sem precisar de `!important`.

**Cuidado com Chart.js:** o comentário em `admin.html:24-27` explica que `getComputedStyle().getPropertyValue()`
não resolve `var()` aninhado — por isso o arquivo mantém constantes "compat" com valor
hex literal (`--gold`, `--card-bg-solid`, etc.) além dos tokens RGB triplet. Isso precisa
ser preservado no `theme.css` compartilhado, senão os gráficos do admin quebram.

## Fases de execução

**Fase 0 — Extrair o sistema compartilhado**
Copiar o bloco de tokens + componentes de `admin.html` (linhas 14-193, 367-377, 586-587,
639-700, 1195+ para o JS do modal) para `webroot/assets/theme.css` e `assets/modal.js`.
Atualizar `admin.html` pra linkar os arquivos externos e remover a duplicata inline.
Validar visualmente que `admin.html` não regrediu (é a referência).

**Fase 1 — `barber.html`**
Linkar `theme.css`/`modal.js`, remover tokens locais duplicados, adicionar `.bg-blobs`,
substituir as 6 chamadas de `confirm()`/`alert()` pelos helpers do modal.

**Fase 2 — `minha-conta.html`**
Migrar pros tokens compartilhados, substituir o `confirm()` da linha 158, checar hover
de cartões e scrollbar.

**Fase 3 — `login.html`**
Migrar pros tokens compartilhados. Decisão em aberto (ver abaixo): manter dark-only ou
adicionar toggle.

**Fase 4 — QA visual**
Checar em todas as páginas: toggle claro/escuro, `prefers-reduced-motion` nos blobs
(já existe media query em `admin.html:193` — replicar), responsividade mobile (o painel
já passou por um ajuste mobile recente — reconferir que o `theme.css` não regride isso),
foco de teclado visível (`:focus-visible` já definido nos tokens).

## Decisões em aberto (pra resolver na sessão de execução, não travar o plano nisso)

1. **`login.html` precisa de toggle de tema?** Tela pré-autenticação, normalmente ganha
   menos investimento de personalização. Recomendo manter dark-only (é a tela de entrada,
   dourado-sobre-escuro já comunica a identidade premium sem precisar de toggle) — mas
   migrar pros tokens compartilhados de qualquer forma, pra não divergir visualmente.
2. **`chat.html` fica 100% fora?** Recomendo sim — é uma ferramenta de simulação/debug do
   bot de WhatsApp, e o realismo da paleta verde/branco é funcional (ajuda a visualizar
   como o cliente real vê a conversa), não estético. Se quiser, dá pra aplicar só o fundo
   da página (fora do "telefone") com os blobs, mantendo o mockup do telefone intocado.
3. **Hover "respirando" em `admin.html`** — confirmar na execução se `.card:hover` já tem
   `translateY(-2px) scale(1.008)` ou só `.btn-danger` tem tratamento de hover hoje; se
   faltar, é o único ajuste real pedido que a referência ainda não cobre.

## O que NÃO fazer

- Não introduzir Tailwind/build step — o ganho não justifica o custo numa app de 5 páginas
  estáticas.
- Não tocar no mockup de WhatsApp dentro de `chat.html`.
- Não recriar o modal customizado do zero — extrair o que já existe em `admin.html`.
