// Script avulso (não faz parte do build/deploy) pra encher a "Barbearia
// Vintage" de agendamentos: histórico "bom" nos últimos 90 dias (maioria
// concluído + avaliação 4-5 estrelas, uma minoria de cancelado/não
// compareceu pra não ficar artificial) e agenda futura lotada nos próximos
// 30 dias. Roda direto contra o banco configurado em .env.
//
// Idempotente: cada dia só é completado até um "piso" de agendamentos — se
// já tiver o suficiente (de uma rodada anterior ou dados reais), pula. Rodar
// de novo só "enche mais" sem duplicar nada.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SHOP_NAME = "Barbearia Vintage";
const DAYS_BACK = 90;
const DAYS_FORWARD = 30;

const CLIENT_NAMES = [
  "Wesley Nogueira", "Igor Machado", "Cauê Barbosa", "Yuri Antunes", "Breno Salles",
  "Diego Farias", "Emanuel Reis", "Nicolas Prado", "Kaique Moreira", "Vitor Hugo Sales",
  "Anderson Melo", "Wagner Duarte", "Sérgio Batista", "Adriano Franco", "Marcos Vinícius",
  "Douglas Peixoto", "Jefferson Aquino", "Rogério Camargo", "Cristiano Faria", "Elias Coutinho",
  "Henrique Bittencourt", "Murilo Guimarães", "Pietro Cordeiro", "Théo Marinho", "Bento Siqueira",
  "Levi Andrade", "Noah Cavalcante", "Heitor Barreto", "Benício Tavares", "Ravi Monteiro",
];

const REVIEW_COMMENTS = [
  "Atendimento excelente, sempre saio satisfeito!",
  "Melhor barbearia da região, super recomendo.",
  "Profissionais atenciosos e ambiente muito limpo.",
  "Corte impecável, já virei cliente fiel.",
  "Pontualidade e capricho, nota 10.",
  "Sempre um ótimo papo enquanto corta o cabelo.",
  "Preço justo pela qualidade do serviço.",
  null,
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
  const shop = await prisma.business.findFirst({ where: { name: SHOP_NAME } });
  if (!shop) throw new Error(`Barbearia "${SHOP_NAME}" não encontrada.`);

  const barbers = await prisma.professional.findMany({ where: { businessId: shop.id, active: true } });
  const services = await prisma.service.findMany({ where: { businessId: shop.id, active: true } });
  if (barbers.length === 0 || services.length === 0) {
    throw new Error(`"${SHOP_NAME}" não tem barbeiro/serviço ativo — cadastre antes de rodar o seed.`);
  }
  console.log(`"${SHOP_NAME}" (businessId ${shop.id}): ${barbers.length} barbeiro(s) ativo(s), ${services.length} serviço(s) ativo(s).`);

  const clientPool = await Promise.all(
    CLIENT_NAMES.map((name, i) => findOrCreateClient(name, `1191${(700000 + i).toString()}`))
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  let created = 0;
  let reviewsCreated = 0;

  // slot de 30min por barbeiro, dentro do horário de funcionamento do dia.
  async function scheduleOne(
    dateStr: string,
    busy: Record<number, { start: number; end: number }[]>,
    openMin: number,
    closeMin: number,
    status: "scheduled" | "confirmed" | "cancelled" | "no_show",
    restrictStart?: number,
    restrictEnd?: number
  ) {
    const barber = barbers[Math.floor(Math.random() * barbers.length)]!;
    const service = services[Math.floor(Math.random() * services.length)]!;
    const lo = restrictStart ?? openMin;
    const hi = restrictEnd ?? closeMin;
    const maxStart = hi - service.durationMin;
    if (maxStart < lo) return false;
    const slotCount = Math.max(1, Math.floor((maxStart - lo) / 30) + 1);

    for (let attempt = 0; attempt < 8; attempt++) {
      const start = lo + Math.floor(Math.random() * slotCount) * 30;
      const end = start + service.durationMin;
      if (end > hi) continue;
      const list = busy[barber.id] || [];
      if (list.some((b) => start < b.end && end > b.start)) continue;

      busy[barber.id] = [...list, { start, end }];
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
      created++;
      return true;
    }
    return false;
  }

  function pickPastStatus(): "confirmed" | "cancelled" | "no_show" {
    const r = Math.random();
    if (r < 0.87) return "confirmed"; // história boa: maioria concluído
    if (r < 0.94) return "no_show";
    return "cancelled";
  }

  // Histórico — últimos DAYS_BACK dias, alvo de 4 a 9 agendamentos/dia
  // (distribuídos entre os barbeiros ativos).
  for (let offset = DAYS_BACK; offset >= 1; offset--) {
    const day = new Date(today);
    day.setDate(day.getDate() - offset);
    const dateStr = localDateStr(day);
    const hours = await prisma.businessHours.findUnique({ where: { businessId_weekday: { businessId: shop.id, weekday: day.getDay() } } });
    if (!hours || hours.closed) continue;
    const openMin = timeToMinutes(hours.opensAt);
    const closeMin = timeToMinutes(hours.closesAt);

    const existingRows = await prisma.appointment.findMany({
      where: { businessId: shop.id, date: new Date(`${dateStr}T00:00:00`), status: { not: "cancelled" } },
    });
    if (existingRows.length >= 4) continue;

    const busy: Record<number, { start: number; end: number }[]> = {};
    for (const a of existingRows) {
      const list = busy[a.professionalId] || [];
      list.push({ start: timeToMinutes(a.startTime), end: timeToMinutes(a.endTime) });
      busy[a.professionalId] = list;
    }

    const target = 4 + Math.floor(Math.random() * 6); // 4 a 9
    for (let n = existingRows.length; n < target; n++) {
      await scheduleOne(dateStr, busy, openMin, closeMin, pickPastStatus());
    }
  }
  console.log(`Histórico: ${created} agendamento(s) criado(s) até agora.`);
  const createdPastCount = created;

  // Hoje — completa até um piso, restringindo horário passado a "confirmed"
  // (já aconteceu) e horário futuro a "scheduled"/"confirmed" (ainda por vir).
  const todayStr = localDateStr(today);
  const todayHours = await prisma.businessHours.findUnique({ where: { businessId_weekday: { businessId: shop.id, weekday: today.getDay() } } });
  if (todayHours && !todayHours.closed) {
    const openMin = timeToMinutes(todayHours.opensAt);
    const closeMin = timeToMinutes(todayHours.closesAt);
    const existingRows = await prisma.appointment.findMany({ where: { businessId: shop.id, date: new Date(`${todayStr}T00:00:00`), status: { not: "cancelled" } } });
    const busy: Record<number, { start: number; end: number }[]> = {};
    for (const a of existingRows) {
      const list = busy[a.professionalId] || [];
      list.push({ start: timeToMinutes(a.startTime), end: timeToMinutes(a.endTime) });
      busy[a.professionalId] = list;
    }

    if (nowMin > openMin + 30) {
      const doneSoFar = existingRows.filter((a) => timeToMinutes(a.endTime) <= nowMin).length;
      for (let n = doneSoFar; n < 3; n++) await scheduleOne(todayStr, busy, openMin, closeMin, "confirmed", openMin, Math.min(nowMin, closeMin));
    }
    if (nowMin < closeMin - 30) {
      const upcomingSoFar = existingRows.filter((a) => timeToMinutes(a.startTime) > nowMin).length;
      for (let n = upcomingSoFar; n < 4; n++) {
        const status = Math.random() < 0.4 ? "confirmed" : "scheduled";
        await scheduleOne(todayStr, busy, openMin, closeMin, status, Math.max(openMin, nowMin + 20), closeMin);
      }
    }
  }

  // Futuro — amanhã até DAYS_FORWARD dias à frente, alvo de 3 a 8/dia, mix
  // de "scheduled" (recém-criado, cliente ainda não confirmou) e
  // "confirmed" (já clicou no link do lembrete).
  for (let offset = 1; offset <= DAYS_FORWARD; offset++) {
    const day = new Date(today);
    day.setDate(day.getDate() + offset);
    const dateStr = localDateStr(day);
    const hours = await prisma.businessHours.findUnique({ where: { businessId_weekday: { businessId: shop.id, weekday: day.getDay() } } });
    if (!hours || hours.closed) continue;
    const openMin = timeToMinutes(hours.opensAt);
    const closeMin = timeToMinutes(hours.closesAt);

    const existingRows = await prisma.appointment.findMany({
      where: { businessId: shop.id, date: new Date(`${dateStr}T00:00:00`), status: { not: "cancelled" } },
    });
    if (existingRows.length >= 3) continue;

    const busy: Record<number, { start: number; end: number }[]> = {};
    for (const a of existingRows) {
      const list = busy[a.professionalId] || [];
      list.push({ start: timeToMinutes(a.startTime), end: timeToMinutes(a.endTime) });
      busy[a.professionalId] = list;
    }

    const target = 3 + Math.floor(Math.random() * 6); // 3 a 8
    for (let n = existingRows.length; n < target; n++) {
      const status = Math.random() < 0.4 ? "confirmed" : "scheduled";
      await scheduleOne(dateStr, busy, openMin, closeMin, status);
    }
  }
  console.log(`Futuro: ${created - createdPastCount} agendamento(s) criado(s) até agora.`);

  // Avaliações — pega agendamentos passados "confirmed" (concluídos) sem
  // review ainda e dá nota alta numa fatia deles (não em todos, pra não
  // ficar artificial).
  const completedWithoutReview = await prisma.appointment.findMany({
    where: { businessId: shop.id, status: "confirmed", date: { lt: today }, review: null },
    orderBy: { date: "desc" },
  });
  for (const a of completedWithoutReview) {
    if (Math.random() >= 0.55) continue; // ~55% dos concluídos recebem avaliação
    const rating = Math.random() < 0.75 ? 5 : 4; // maioria 5 estrelas, história boa
    const comment = REVIEW_COMMENTS[Math.floor(Math.random() * REVIEW_COMMENTS.length)];
    await prisma.review.create({
      data: { appointmentId: a.id, businessId: shop.id, professionalId: a.professionalId, clientId: a.clientId, rating, comment: comment ?? null },
    });
    reviewsCreated++;
  }
  console.log(`Avaliações: ${reviewsCreated} criada(s).`);

  console.log(`\nTotal de agendamentos criados: ${created}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
