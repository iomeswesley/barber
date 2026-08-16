// Parser mínimo de .ics (RFC 5545) — só o suficiente pra extrair VEVENTs e
// virar bloqueios de horário (Business.icalImportUrl, src/jobs/icalImport.ts).
// Não é um parser completo: ignora recorrência (RRULE), exceções (EXDATE),
// fuso horário por VTIMEZONE (datas com "Z" são tratadas como UTC via
// Date nativo; datas com TZID são tratadas como horário local literal,
// aproximação aceitável pro caso de uso "bloquear esse horário", que não
// exige precisão de segundo).
export interface IcsEvent {
  uid: string;
  summary: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  allDay: boolean;
}

// Linhas longas no .ics vêm "dobradas" (continuação começa com espaço/tab)
// — sem desdobrar antes, uma propriedade cortada no meio vira lixo.
function unfold(text: string): string[] {
  const rawLines = text.split(/\r\n|\n|\r/);
  const lines: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function parseDateValue(raw: string): { date: string; time: string | null } {
  // raw pode vir como "20260901" (all-day) ou "20260901T143000Z"/"20260901T143000"
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(raw);
  if (!m) return { date: raw, time: null };
  const [, y, mo, d, h, mi, , z] = m;
  const date = `${y}-${mo}-${d}`;
  if (h === undefined) return { date, time: null };
  if (z === "Z") {
    // UTC -> aproxima pro horário local do servidor (America/Sao_Paulo em
    // produção); suficiente pro propósito de bloqueio, não crítico por segundo.
    const utcDate = new Date(`${date}T${h}:${mi}:00Z`);
    const localH = utcDate.getHours().toString().padStart(2, "0");
    const localM = utcDate.getMinutes().toString().padStart(2, "0");
    return { date: localDateOf(utcDate), time: `${localH}:${localM}` };
  }
  return { date, time: `${h}:${mi}` };
}

function localDateOf(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
}

function propValue(line: string): string {
  // "DTSTART;VALUE=DATE:20260901" ou "DTSTART:20260901T140000Z" -> pega só
  // o que vem depois do ÚLTIMO ":" (parâmetros como TZID não têm ":" no
  // valor, então isso é seguro).
  return line.slice(line.lastIndexOf(":") + 1).trim();
}

export function parseIcs(text: string): IcsEvent[] {
  const lines = unfold(text);
  const events: IcsEvent[] = [];
  let inEvent = false;
  let uid = "";
  let summary = "";
  let dtstart: string | null = null;
  let dtend: string | null = null;

  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) {
      inEvent = true;
      uid = "";
      summary = "";
      dtstart = null;
      dtend = null;
      continue;
    }
    if (line.startsWith("END:VEVENT")) {
      if (inEvent && dtstart) {
        const start = parseDateValue(dtstart);
        const end = dtend ? parseDateValue(dtend) : null;
        const allDay = start.time === null;
        events.push({
          uid: uid || `${start.date}-${Math.random().toString(36).slice(2)}`,
          summary: summary || "(sem título)",
          date: start.date,
          startTime: allDay ? "00:00" : start.time!,
          endTime: allDay ? "23:59" : end?.time || start.time!,
          allDay,
        });
      }
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;
    if (line.startsWith("UID")) uid = propValue(line);
    else if (line.startsWith("SUMMARY")) summary = propValue(line);
    else if (line.startsWith("DTSTART")) dtstart = propValue(line);
    else if (line.startsWith("DTEND")) dtend = propValue(line);
  }
  return events;
}
