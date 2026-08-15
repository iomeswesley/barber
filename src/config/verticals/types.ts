// Vocabulário de negócio de cada vertical atendido pelo motor único (ver
// CLAUDE.md / plano de unificação). O backend (chatEngine, notificações,
// seed, webroot — este último ainda não migrado) consome esses valores em
// vez de ter o texto em português hardcoded e duplicado por repositório.
//
// Nomes de model/coluna no Prisma já são genéricos (Business/Professional) —
// este vocabulário é só a CAMADA DE TEXTO em cima disso.
export interface Vertical {
  id: string;

  // Substantivos usados no prompt da IA, notificações, seed, etc.
  business: string; // "clínica" | "barbearia"
  businessPlural: string;
  // Sufixo opcional colado em "clínica"/"barbearia" na primeira menção do
  // prompt (ex: "clínica odontológica") — string vazia se não se aplica.
  businessAdjective: string;
  professional: string; // "dentista" | "barbeiro"
  professionalPlural: string;
  client: string; // "paciente" | "cliente"
  clientPlural: string;
  service: string; // "procedimento" | "serviço"
  servicePlural: string;

  // Trechos de conteúdo genuinamente diferentes por vertical (não é troca
  // mecânica de palavra) — ver chatEngine.ts pra onde cada um entra.
  emergencyClause: string; // frase completa sobre quando escalar por emergência
  planBenefitExample: string; // exemplo de benefício de plano de assinatura

  // Identidade visual/produto.
  brandIcon: "brand-tooth" | "brand-razor";
  // Emoji de marca usado em texto plano (templates de WhatsApp aprovados
  // pela Meta, que não suportam SVG/ícone — só texto/emoji literal).
  brandEmoji: string;
  appName: string; // ex: "Odonto Bot" / "Barbearia Bot" (manifest.json)
  productionDomain: string; // ex: "agenda-dent.vercel.app"
  demoCredentialPrefix: string; // ex: "odonto-dent" (login de demonstração)
}
