// Utilitários de data/hora compartilhados — HH:MM em minutos desde 00:00 e
// datas locais "YYYY-MM-DD", igual à convenção usada em barbearia-bot/src/db.js.

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60)
    .toString()
    .padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d
    .getDate()
    .toString()
    .padStart(2, "0")}`;
}

// Coluna @db.Date (só dia, sem hora) a partir de "YYYY-MM-DD": meia-noite UTC,
// nunca meia-noite LOCAL. O Prisma serializa o Date em UTC e o Postgres guarda
// a parte de data — `new Date("2026-09-18T00:00:00")` (local) só dava o dia
// certo em fuso a oeste de UTC (Brasil, -03); a leste (Luxemburgo, +01/+02)
// virava 17/09 22:00Z e gravava o dia anterior. Pra leitura use dbDateToStr.
export function dateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

// Inverso de dateOnly: o dia de uma coluna @db.Date lido do banco (UTC, sem
// conversão de fuso — localDateStr aqui deslocaria o dia em fuso ≠ UTC).
export function dbDateToStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// JS Date's getDay() (0=Dom...6=Sáb) casa com nossa convenção de weekday desde
// que a data seja construída ao meio-dia local, evitando virada de fuso à meia-noite.
export function weekdayForDateStr(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00`).getDay();
}

export function nowLocalTimeStr(now: Date = new Date()): string {
  return `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
}

export function normalizePhone(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}
