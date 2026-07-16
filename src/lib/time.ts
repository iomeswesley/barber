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
