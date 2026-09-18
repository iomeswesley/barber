// Localização por negócio (Business.locale/country/timezone/currency).
// Idioma/país são configuração do tenant, nunca detectados por IP — ver
// comentário no model Business (prisma/schema.prisma).

export const SUPPORTED_LOCALES = ["pt-BR", "fr", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "pt-BR";

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

// Valor vindo do banco é string livre (sem enum de propósito); qualquer coisa
// desconhecida cai no padrão histórico em vez de quebrar o envio/prompt.
export function normalizeLocale(value: string | null | undefined): Locale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

// A Meta usa underscore e códigos próprios pra Message Templates
// (pt_BR, fr, en) — diferente do BCP47 que guardamos no banco.
const META_LANGUAGE_CODES: Record<Locale, string> = {
  "pt-BR": "pt_BR",
  fr: "fr",
  en: "en",
};

export function metaLanguageCode(locale: string | null | undefined): string {
  return META_LANGUAGE_CODES[normalizeLocale(locale)];
}

const WEEKDAY_NAMES: Record<Locale, string[]> = {
  "pt-BR": ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"],
  fr: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

export function weekdayName(locale: string | null | undefined, dayIndex: number): string {
  return WEEKDAY_NAMES[normalizeLocale(locale)][dayIndex]!;
}

// Nome do idioma em português, pra instruir o bot (o prompt é escrito em pt).
const LANGUAGE_LABELS: Record<Locale, string> = {
  "pt-BR": "português do Brasil",
  fr: "francês",
  en: "inglês",
};

export function languageLabel(locale: string | null | undefined): string {
  return LANGUAGE_LABELS[normalizeLocale(locale)];
}

// Preço mostrado ao cliente final. BRL em pt-BR mantém o formato histórico
// do bot ("R$ 99", arredondado, sem centavos — os testes/prompt dependem
// disso). Qualquer outra combinação usa Intl e só mostra centavos quando
// existirem ("15 €" / "€15.50"), pra não arredondar preço em euro errado.
export function formatMoney(cents: number, currency = "BRL", locale: string | null | undefined = DEFAULT_LOCALE): string {
  const loc = normalizeLocale(locale);
  if (currency === "BRL" && loc === "pt-BR") return `R$ ${Math.round(cents / 100)}`;
  const hasCents = cents % 100 !== 0;
  return new Intl.NumberFormat(loc, {
    style: "currency",
    currency,
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
