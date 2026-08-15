// Script avulso (não faz parte do build/deploy) pra criar/enriquecer uma
// barbearia de demonstração extra com UM ÚNICO barbeiro — pra testar o "modo
// automático barbeiro-único vs múltiplos barbeiros" (ver applyBarberModeGating
// em webroot/admin.html) sem mexer nos dados da "Barbearia Vintage" original,
// que tem 3 barbeiros. Roda direto contra o banco configurado em .env.
//
// Seguro rodar mais de uma vez: a criação da barbearia/barbeiro/usuários só
// acontece na primeira vez, mas cada etapa de dados (agendamentos, avaliações,
// produtos, escalonamento) tem sua própria checagem e só adiciona o que ainda
// não existe — então rodar de novo só "enche mais" sem duplicar nada.
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth.js";

const prisma = new PrismaClient();
const DEMO_PASSWORD = "barbearia123";
const SHOP_NAME = "Barbearia Solo";
const BARBER_NAME = "Marcos";

function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

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

const CLIENT_NAMES = [
  "Beatriz Cunha", "Camila Rezende", "Larissa Prado", "Juliana Barros", "Patrícia Nunes",
  "Sabrina Duarte", "Vanessa Freitas", "Priscila Farias", "Débora Azevedo", "Aline Monteiro",
  "Fernanda Lopes", "Tatiane Rocha", "Carolina Melo", "Bianca Teixeira", "Renata Pires",
];

const REVIEW_COMMENTS = [
  "Atendimento excelente, super recomendo!",
  "Marcos é muito atencioso, adorei o corte.",
  "Barbearia limpa e organizada, sem espera.",
  "Melhor experiência que já tive numa barbearia.",
  "Explicou tudo com calma, fiquei bem satisfeito.",
  null,
  null,
];

async function findOrCreateClient(name: string, phone: string) {
  const existing = await prisma.client.findUnique({ where: { phone } });
  if (existing) return existing;
  return prisma.client.create({ data: { name, phone, marketingOptIn: true } });
}

async function ensureShop() {
  const existing = await prisma.business.findFirst({ where: { name: SHOP_NAME } });
  if (existing) return existing;

  const shop = await prisma.business.create({
    data: { name: SHOP_NAME, address: "Rua das Palmeiras, 45 - Centro", phone: "(11) 99999-1113" },
  });
  const barber = await prisma.professional.create({ data: { businessId: shop.id, name: BARBER_NAME } });
  await Promise.all(
    [
      ["Corte Masculino", 4000, 45],
      ["Barba", 2500, 20],
      ["Corte + Barba", 6000, 60],
      ["Sobrancelha", 1500, 10],
    ].map(([name, price, duration]) =>
      prisma.service.create({ data: { businessId: shop.id, name: name as string, priceCents: price as number, durationMin: duration as number } })
    )
  );
  for (let weekday = 0; weekday <= 6; weekday++) {
    await prisma.businessHours.create({
      data: { businessId: shop.id, weekday, opensAt: "09:00", closesAt: "19:00", closed: weekday === 0 },
    });
  }

  const passwordHash = hashPassword(DEMO_PASSWORD);
  const ownerUsername = `${slugify(shop.name)}.dono`;
  await prisma.user.create({
    data: { businessId: shop.id, role: "owner", username: ownerUsername, passwordHash, name: `Dono(a) da ${shop.name}` },
  });
  const barberUsername = slugify(barber.name);
  await prisma.user.create({
    data: { businessId: shop.id, professionalId: barber.id, role: "professional", username: barberUsername, passwordHash, name: barber.name },
  });

  console.log(`"${SHOP_NAME}" criada (businessId ${shop.id}) com 1 barbeiro.`);
  console.log(`Login dono:     ${ownerUsername}  ·  senha: ${DEMO_PASSWORD}`);
  console.log(`Login barbeiro: ${barberUsername}  ·  senha: ${DEMO_PASSWORD}`);
  return shop;
}

async function ensureHistoricalAppointments(businessId: number, professionalId: number) {
  const clientPool = await Promise.all(
    CLIENT_NAMES.map((name, i) => findOrCreateClient(name, `1191${(500000 + i).toString()}`))
  );
  const services = await prisma.service.findMany({ where: { businessId, active: true } });
  const DAYS_BACK = 60;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  async function scheduleRandom(dateStr: string, busy: { start: number; end: number }[], openMin: number, closeMin: number, restrictStart?: number, restrictEnd?: number) {
    const service = services[Math.floor(Math.random() * services.length)]!;
    const lo = restrictStart ?? openMin;
    const hi = restrictEnd ?? closeMin;
    const maxStart = hi - service.durationMin;
    if (maxStart < lo) return busy;
    const slotCount = Math.max(1, Math.floor((maxStart - lo) / 30) + 1);
    for (let attempt = 0; attempt < 6; attempt++) {
      const start = lo + Math.floor(Math.random() * slotCount) * 30;
      const end = start + service.durationMin;
      if (end > hi) continue;
      if (busy.some((b) => start < b.end && end > b.start)) continue;
      const clientRow = clientPool[Math.floor(Math.random() * clientPool.length)]!;
      await prisma.appointment.create({
        data: {
          businessId,
          professionalId,
          serviceId: service.id,
          clientId: clientRow.id,
          date: new Date(`${dateStr}T00:00:00`),
          startTime: minutesToTime(start),
          endTime: minutesToTime(end),
        },
      });
      return [...busy, { start, end }];
    }
    return busy;
  }

  // Passado — só completa até o "chão" de 3 agendamentos/dia se já tiver
  // menos que isso (evita duplicar tudo de novo a cada rodada do script).
  for (let offset = DAYS_BACK; offset >= 1; offset--) {
    const day = new Date(today);
    day.setDate(day.getDate() - offset);
    const dateStr = localDateStr(day);
    const hours = await prisma.businessHours.findUnique({ where: { businessId_weekday: { businessId, weekday: day.getDay() } } });
    if (!hours || hours.closed) continue;
    const openMin = timeToMinutes(hours.opensAt);
    const closeMin = timeToMinutes(hours.closesAt);

    const existingCount = await prisma.appointment.count({
      where: { businessId, date: new Date(`${dateStr}T00:00:00`), status: { not: "cancelled" } },
    });
    const target = 2 + Math.floor(Math.random() * 4);
    if (existingCount >= target) continue;

    const existingRows = await prisma.appointment.findMany({
      where: { businessId, date: new Date(`${dateStr}T00:00:00`), status: { not: "cancelled" } },
    });
    let busyDay = existingRows.map((a) => ({ start: timeToMinutes(a.startTime), end: timeToMinutes(a.endTime) }));
    for (let n = existingCount; n < target; n++) busyDay = await scheduleRandom(dateStr, busyDay, openMin, closeMin);
  }

  // Hoje — garante alguns concluídos (pro KPI "realizado" não ficar zerado) e
  // alguns futuros ainda no dia (pra "Agendamentos de hoje" não ficar vazio).
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayStr = localDateStr(today);
  const todayHours = await prisma.businessHours.findUnique({ where: { businessId_weekday: { businessId, weekday: today.getDay() } } });
  if (todayHours && !todayHours.closed) {
    const openMin = timeToMinutes(todayHours.opensAt);
    const closeMin = timeToMinutes(todayHours.closesAt);
    const existingRows = await prisma.appointment.findMany({ where: { businessId, date: new Date(`${todayStr}T00:00:00`), status: { not: "cancelled" } } });
    let busyToday = existingRows.map((a) => ({ start: timeToMinutes(a.startTime), end: timeToMinutes(a.endTime) }));

    if (nowMin > openMin + 30 && existingRows.filter((a) => timeToMinutes(a.endTime) <= nowMin).length < 2) {
      for (let n = 0; n < 2; n++) busyToday = await scheduleRandom(todayStr, busyToday, openMin, closeMin, openMin, Math.min(nowMin, closeMin));
    }
    if (nowMin < closeMin - 30 && existingRows.filter((a) => timeToMinutes(a.startTime) > nowMin).length < 3) {
      for (let n = 0; n < 3; n++) busyToday = await scheduleRandom(todayStr, busyToday, openMin, closeMin, Math.max(openMin, nowMin + 20), closeMin);
    }
  }

  // Futuro — de amanhã até o fim do próximo mês, mesmo padrão de "piso" de
  // agendamentos por dia do loop de passado (idempotente: só completa o que
  // falta pra bater o alvo, então rodar de novo não duplica).
  const nextMonthEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0);
  for (let day = new Date(today); day <= nextMonthEnd; day.setDate(day.getDate() + 1)) {
    if (sameDayAs(day, today)) continue; // hoje já foi tratado acima
    const dateStr = localDateStr(day);
    const hours = await prisma.businessHours.findUnique({ where: { businessId_weekday: { businessId, weekday: day.getDay() } } });
    if (!hours || hours.closed) continue;
    const openMinF = timeToMinutes(hours.opensAt);
    const closeMinF = timeToMinutes(hours.closesAt);

    const existingCount = await prisma.appointment.count({
      where: { businessId, date: new Date(`${dateStr}T00:00:00`), status: { not: "cancelled" } },
    });
    const target = 2 + Math.floor(Math.random() * 4);
    if (existingCount >= target) continue;

    const existingRows = await prisma.appointment.findMany({
      where: { businessId, date: new Date(`${dateStr}T00:00:00`), status: { not: "cancelled" } },
    });
    let busyDay = existingRows.map((a) => ({ start: timeToMinutes(a.startTime), end: timeToMinutes(a.endTime) }));
    for (let n = existingCount; n < target; n++) busyDay = await scheduleRandom(dateStr, busyDay, openMinF, closeMinF);
  }
}

function sameDayAs(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

async function ensureReviews(businessId: number, professionalId: number) {
  const completedWithoutReview = await prisma.appointment.findMany({
    where: {
      businessId,
      status: { not: "cancelled" },
      date: { lt: new Date() },
      review: null,
    },
    take: 12,
    orderBy: { date: "desc" },
  });
  for (const a of completedWithoutReview) {
    const rating = 4 + Math.floor(Math.random() * 2); // 4 ou 5 — demo positiva
    const comment = REVIEW_COMMENTS[Math.floor(Math.random() * REVIEW_COMMENTS.length)];
    await prisma.review.create({
      data: { appointmentId: a.id, businessId, professionalId, clientId: a.clientId, rating, comment: comment ?? null },
    });
  }
  if (completedWithoutReview.length > 0) {
    console.log(`${completedWithoutReview.length} avaliação(ões) criada(s).`);
  }
}

async function ensureProducts(businessId: number) {
  const count = await prisma.product.count({ where: { businessId } });
  if (count > 0) return;
  await prisma.product.createMany({
    data: [
      { businessId, name: "Pomada modeladora", priceCents: 4500, stockQuantity: 2, lowStockThreshold: 5 },
      { businessId, name: "Óleo de barba", priceCents: 3800, stockQuantity: 12, lowStockThreshold: 4 },
      { businessId, name: "Shampoo anticaspa", priceCents: 2500, stockQuantity: 30, lowStockThreshold: 10 },
    ],
  });
  console.log("3 produtos criados (1 com estoque baixo de propósito).");
}

async function ensureEscalation(businessId: number) {
  const count = await prisma.escalation.count({ where: { businessId, resolved: false } });
  if (count > 0) return;
  const client = await prisma.client.findFirst({ where: { phone: "1191500002" } });
  if (!client) return;
  await prisma.escalation.create({
    data: { businessId, clientId: client.id, clientPhone: client.phone, reason: "Cliente pediu pra falar com um humano sobre um caso urgente." },
  });
  console.log("1 escalonamento pendente criado.");
}

async function main() {
  const shop = await ensureShop();
  const barber = await prisma.professional.findFirstOrThrow({ where: { businessId: shop.id } });

  await ensureHistoricalAppointments(shop.id, barber.id);
  await ensureReviews(shop.id, barber.id);
  await ensureProducts(shop.id);
  await ensureEscalation(shop.id);

  console.log('\nDados de demonstração da "Barbearia Solo" atualizados.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
