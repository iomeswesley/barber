// Script avulso (não faz parte do build/deploy), roda uma vez só: reativa os
// barbeiros da "Barbearia Vintage" que estavam com active=false e redistribui
// os agendamentos futuros (hoje só concentrados no barbeiro ativo único) entre
// todos eles, respeitando conflito de horário por barbeiro. O histórico
// passado (últimos 90 dias) já estava bem distribuído entre Carlos/Diego/
// Rafael/Wesley — só o "Barbeiro 4", que nunca teve nenhum agendamento, ganha
// um pouco de história pra não ficar deslocado dos outros. Roda direto contra
// o banco configurado em .env.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SHOP_NAME = "Barbearia Vintage";

const CLIENT_NAMES = [
  "Otávio Nunes", "Fábio Serra", "Guilherme Assis", "Márcio Vasconcelos", "Ederson Brito",
  "Vagner Lacerda", "Danilo Xavier", "Emerson Paiva", "Everton Godoy", "Robson Amaral",
];

const REVIEW_COMMENTS = [
  "Atendimento excelente, sempre saio satisfeito!",
  "Corte impecável, já virei cliente fiel.",
  "Pontualidade e capricho, nota 10.",
  "Preço justo pela qualidade do serviço.",
  null,
  null,
];

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
}
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60).toString().padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

async function findOrCreateClient(name: string, phone: string) {
  const existing = await prisma.client.findUnique({ where: { phone } });
  if (existing) return existing;
  return prisma.client.create({ data: { name, phone, marketingOptIn: true } });
}

async function main() {
  const shop = await prisma.business.findFirstOrThrow({ where: { name: SHOP_NAME } });

  // 1) Reativa todo mundo.
  const reactivated = await prisma.professional.updateMany({
    where: { businessId: shop.id, active: false },
    data: { active: true },
  });
  console.log(`${reactivated.count} barbeiro(s) reativado(s).`);

  const barbers = await prisma.professional.findMany({ where: { businessId: shop.id, active: true }, orderBy: { id: "asc" } });
  console.log("Barbeiros ativos agora:", barbers.map((b) => b.name).join(", "));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 2) Redistribui os agendamentos futuros (hoje em diante) entre todos os
  // barbeiros ativos. Monta o "busy" de cada barbeiro a partir do que já
  // existe no banco pra cada data (evita sobrepor agenda ao mover).
  const futureAppts = await prisma.appointment.findMany({
    where: { businessId: shop.id, status: { not: "cancelled" }, date: { gte: today } },
    orderBy: { date: "asc" },
  });

  // busyByDateBarber["2026-08-17"][barberId] = [{start,end}, ...]
  const busyByDateBarber: Record<string, Record<number, { start: number; end: number }[]>> = {};
  function markBusy(dateStr: string, barberId: number, start: number, end: number) {
    busyByDateBarber[dateStr] ??= {};
    busyByDateBarber[dateStr][barberId] ??= [];
    busyByDateBarber[dateStr][barberId]!.push({ start, end });
  }
  function isFree(dateStr: string, barberId: number, start: number, end: number) {
    const list = busyByDateBarber[dateStr]?.[barberId] ?? [];
    return !list.some((b) => start < b.end && end > b.start);
  }

  // Pré-carrega o busy atual (todo mundo, pra não sobrepor com agendamentos
  // que não serão movidos).
  for (const a of futureAppts) {
    const dateStr = localDateStr(a.date);
    markBusy(dateStr, a.professionalId, timeToMinutes(a.startTime), timeToMinutes(a.endTime));
  }

  let moved = 0;
  let barberCursor = 0;
  for (const a of futureAppts) {
    const dateStr = localDateStr(a.date);
    const start = timeToMinutes(a.startTime);
    const end = timeToMinutes(a.endTime);
    const currentBarberId = a.professionalId;

    // Tenta achar outro barbeiro livre nesse horário, começando por um
    // round-robin pra distribuir igual, com no máximo 1 volta completa.
    let target: number | null = null;
    for (let i = 0; i < barbers.length; i++) {
      const candidate = barbers[(barberCursor + i) % barbers.length]!;
      if (candidate.id === currentBarberId) continue;
      if (isFree(dateStr, candidate.id, start, end)) {
        target = candidate.id;
        barberCursor = (barberCursor + i + 1) % barbers.length;
        break;
      }
    }
    if (target === null) continue; // ninguém livre nesse slot, deixa como está

    // Libera o slot antigo, ocupa o novo.
    const oldList = busyByDateBarber[dateStr]![currentBarberId]!;
    busyByDateBarber[dateStr]![currentBarberId] = oldList.filter((b) => !(b.start === start && b.end === end));
    markBusy(dateStr, target, start, end);

    await prisma.appointment.update({ where: { id: a.id }, data: { professionalId: target } });
    moved++;
  }
  console.log(`${moved} agendamento(s) futuro(s) redistribuído(s) entre os barbeiros.`);

  // 3) Dá uma história mínima de 90 dias pro barbeiro que nunca teve nenhum
  // agendamento (fica esquisito reativado e com histórico zerado do lado dos
  // outros três, que já têm ~150 cada).
  const emptyBarbers = [];
  for (const b of barbers) {
    const count = await prisma.appointment.count({ where: { businessId: shop.id, professionalId: b.id } });
    if (count === 0) emptyBarbers.push(b);
  }
  if (emptyBarbers.length === 0) {
    console.log("Nenhum barbeiro sem histórico — nada a completar.");
    return;
  }

  const services = await prisma.service.findMany({ where: { businessId: shop.id, active: true } });
  const clientPool = await Promise.all(CLIENT_NAMES.map((name, i) => findOrCreateClient(name, `1191${(800000 + i).toString()}`)));

  let created = 0;
  for (const barber of emptyBarbers) {
    for (let offset = 90; offset >= 1; offset--) {
      const day = new Date(today);
      day.setDate(day.getDate() - offset);
      const dateStr = localDateStr(day);
      const hours = await prisma.businessHours.findUnique({ where: { businessId_weekday: { businessId: shop.id, weekday: day.getDay() } } });
      if (!hours || hours.closed) continue;
      const openMin = timeToMinutes(hours.opensAt);
      const closeMin = timeToMinutes(hours.closesAt);

      const existing = await prisma.appointment.findMany({
        where: { businessId: shop.id, professionalId: barber.id, date: new Date(`${dateStr}T00:00:00`), status: { not: "cancelled" } },
      });
      let busy = existing.map((a) => ({ start: timeToMinutes(a.startTime), end: timeToMinutes(a.endTime) }));

      const target = 2 + Math.floor(Math.random() * 3); // 2 a 4/dia — mais discreto, barbeiro novo
      for (let n = existing.length; n < target; n++) {
        const service = services[Math.floor(Math.random() * services.length)]!;
        const maxStart = closeMin - service.durationMin;
        if (maxStart < openMin) continue;
        const slotCount = Math.max(1, Math.floor((maxStart - openMin) / 30) + 1);
        let placed = false;
        for (let attempt = 0; attempt < 6 && !placed; attempt++) {
          const start = openMin + Math.floor(Math.random() * slotCount) * 30;
          const end = start + service.durationMin;
          if (end > closeMin) continue;
          if (busy.some((b) => start < b.end && end > b.start)) continue;
          const rand = Math.random();
          const status = rand < 0.88 ? "confirmed" : rand < 0.95 ? "no_show" : "cancelled";
          const clientRow = clientPool[Math.floor(Math.random() * clientPool.length)]!;
          await prisma.appointment.create({
            data: {
              businessId: shop.id,
              professionalId: barber.id,
              serviceId: service.id,
              clientId: clientRow.id,
              date: new Date(`${dateStr}T00:00:00`),
              startTime: minutesToTime(start),
              endTime: minutesToTime(end),
              status,
            },
          });
          busy = [...busy, { start, end }];
          created++;
          placed = true;
        }
      }
    }
    console.log(`${barber.name}: histórico de 90 dias criado.`);
  }
  console.log(`${created} agendamento(s) de histórico criado(s) para barbeiro(s) sem nenhum registro.`);

  // Avaliações pros novos concluídos.
  let reviewsCreated = 0;
  for (const barber of emptyBarbers) {
    const completedWithoutReview = await prisma.appointment.findMany({
      where: { businessId: shop.id, professionalId: barber.id, status: "confirmed", date: { lt: today }, review: null },
    });
    for (const a of completedWithoutReview) {
      if (Math.random() >= 0.55) continue;
      const rating = Math.random() < 0.75 ? 5 : 4;
      const comment = REVIEW_COMMENTS[Math.floor(Math.random() * REVIEW_COMMENTS.length)];
      await prisma.review.create({
        data: { appointmentId: a.id, businessId: shop.id, professionalId: barber.id, clientId: a.clientId, rating, comment: comment ?? null },
      });
      reviewsCreated++;
    }
  }
  console.log(`${reviewsCreated} avaliação(ões) criada(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
