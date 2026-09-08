// Achado em produção (2026-09-08): em modo Coexistência, o número da
// barbearia continua recebendo TUDO que já recebia antes (operadora,
// banco, promoção, delivery) — não só cliente de verdade. Sem filtro, o
// bot tenta agendar corte de cabelo com a operadora Claro. Único sinal
// confiável que temos: o pushName (nome de perfil do WhatsApp de quem
// manda) — cliente de verdade usa o próprio nome; empresa grande usa o
// nome da marca no WhatsApp Business dela. Lista curada de marcas
// conhecidas que mandam notificação automática no Brasil — não cobre
// tudo, é best-effort mecânico, não substitui o dono revisando a aba
// Mensagens de vez em quando.
const KNOWN_NON_CUSTOMER_SENDERS = [
  // Operadoras
  "claro",
  "claro residencial",
  "claro empresas",
  "vivo",
  "tim",
  "tim brasil",
  "oi",
  "oi fibra",
  "algar telecom",
  // Bancos e fintechs
  "nubank",
  "itaú",
  "itau",
  "bradesco",
  "santander",
  "banco do brasil",
  "caixa",
  "caixa econômica",
  "c6 bank",
  "banco inter",
  "picpay",
  "mercado pago",
  "next",
  "will bank",
  // Delivery, marketplace e transporte
  "ifood",
  "uber",
  "99",
  "99app",
  "mercado livre",
  "amazon",
  "shopee",
  "rappi",
  "magalu",
  "magazine luiza",
  // Utilities
  "enel",
  "cpfl",
  "sabesp",
  "copel",
  "light",
  "cemig",
];

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos (marcas diacríticas combinantes)
    .trim()
    .toLowerCase();
}

// Compara o pushName inteiro (normalizado) contra a lista — exato ou
// prefixo seguido de sufixo comum ("Claro Oficial", "iFood Brasil"), não
// substring solta (evitaria falso positivo tipo "Clarissa" batendo com
// "claro"). pushName vazio/ausente nunca é filtrado — a maioria dos
// clientes reais tem nome de perfil, mas ausência de nome não é sinal de
// nada suspeito por si só.
export function isKnownNonCustomerSender(pushName: string | undefined | null): boolean {
  if (!pushName) return false;
  const normalized = normalize(pushName);
  if (!normalized) return false;
  return KNOWN_NON_CUSTOMER_SENDERS.some((brand) => normalized === brand || normalized.startsWith(`${brand} `));
}
