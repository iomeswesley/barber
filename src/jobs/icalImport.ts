// Importa o calendário externo (.ics) de cada barbearia que configurou
// Business.icalImportUrl (Fase 8, Configurações → Google Agenda / iCal) e
// vira TimeBlock com source="ical_import", pra IA parar de oferecer esses
// horários. Chamado a partir do MESMO cron diário de lembretes (não um
// cron dedicado) — o plano Hobby da Vercel limita a quantidade de crons, e
// isso já roda 1x/dia, cadência suficiente pra esse caso de uso.
import { prisma } from "@/lib/prisma.js";
import { parseIcs } from "@/lib/icsParser.js";

// Só olha os próximos N dias — evita reimportar histórico de anos de um
// calendário grande a cada varredura, sem ganho nenhum (dia passado não
// precisa de bloqueio, ninguém agenda pra ontem).
const LOOKAHEAD_DAYS = 60;

export async function runIcalImport(): Promise<{ businessesProcessed: number; blocksCreated: number; failures: number }> {
  const businesses = await prisma.business.findMany({
    where: { icalImportUrl: { not: null } },
    select: { id: true, icalImportUrl: true },
  });

  let blocksCreated = 0;
  let failures = 0;

  for (const business of businesses) {
    try {
      const res = await fetch(business.icalImportUrl!);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const events = parseIcs(text);

      const today = new Date();
      const cutoff = new Date(today.getTime() + LOOKAHEAD_DAYS * 86400000);
      const relevant = events.filter((e) => {
        const d = new Date(`${e.date}T00:00:00`);
        return d >= new Date(today.toDateString()) && d <= cutoff;
      });

      // Remove os bloqueios importados antes (source="ical_import") dessa
      // barbearia e recria do zero — mais simples e seguro que tentar
      // diffar (evento cancelado no calendário externo precisa sumir do
      // bloqueio também, e comparar por UID exigiria guardar o UID em
      // TimeBlock, campo que não existe hoje). Bloqueios manuais do dono
      // (source="manual") nunca são tocados aqui.
      await prisma.timeBlock.deleteMany({ where: { businessId: business.id, source: "ical_import" } });
      if (relevant.length > 0) {
        await prisma.timeBlock.createMany({
          data: relevant.map((e) => ({
            businessId: business.id,
            professionalId: null, // bloqueia a barbearia toda — v1 não distingue por barbeiro
            type: "outro",
            label: e.summary.slice(0, 120),
            date: new Date(`${e.date}T00:00:00`),
            startTime: e.startTime,
            endTime: e.endTime,
            recurring: false,
            source: "ical_import",
          })),
        });
        blocksCreated += relevant.length;
      }
    } catch (err) {
      failures++;
      console.error(`[ICAL IMPORT] Falha ao importar calendário da barbearia ${business.id}:`, (err as Error).message);
    }
  }

  return { businessesProcessed: businesses.length, blocksCreated, failures };
}
