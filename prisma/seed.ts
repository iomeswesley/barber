import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth.js";
import { env } from "../src/config/env.js";

// Dados de demonstração — nunca deve rodar em produção. server.ts nunca chama
// este script sozinho; é um comando manual (`npm run seed`) e ele mesmo se
// recusa a rodar se SEED_DEMO_DATA não estiver "true" (ver .env.example).
if (!env.SEED_DEMO_DATA) {
  console.error("SEED_DEMO_DATA não está 'true' — recusando semear dados de demonstração. Veja .env.example.");
  process.exit(1);
}

const prisma = new PrismaClient();
const DEMO_PASSWORD = "barbearia123";

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
  "Pedro Almeida", "Lucas Ferreira", "Matheus Costa", "Gabriel Souza", "Rafael Lima",
  "Bruno Alves", "Thiago Rocha", "Felipe Martins", "André Nascimento", "Rodrigo Cardoso",
  "Vinícius Teixeira", "Gustavo Ribeiro", "Leonardo Pereira", "Marcelo Gomes", "Fernando Dias",
  "Eduardo Correia", "Renato Vieira", "Alexandre Moura", "Daniel Castro", "João Pedro",
  "Miguel Santos", "Arthur Oliveira", "Enzo Fernandes", "Davi Cavalcanti", "Otávio Ramos",
];

async function seedShops() {
  const count = await prisma.barbershop.count();
  if (count > 0) return;

  const shop1 = await prisma.barbershop.create({
    data: { name: "Barbearia Vintage", address: "Rua das Flores, 123 - Centro", phone: "(11) 99999-1111" },
  });
  const barbers1 = await Promise.all(
    ["Carlos", "Rafael", "Diego"].map((name) => prisma.barber.create({ data: { barbershopId: shop1.id, name } }))
  );
  await Promise.all(
    [
      ["Corte Masculino", 4000, 45],
      ["Barba", 2500, 20],
      ["Corte + Barba", 6000, 60],
      ["Sobrancelha", 1500, 10],
    ].map(([name, price, duration]) =>
      prisma.service.create({ data: { barbershopId: shop1.id, name: name as string, priceCents: price as number, durationMin: duration as number } })
    )
  );
  for (let weekday = 0; weekday <= 6; weekday++) {
    await prisma.businessHours.create({
      data: { barbershopId: shop1.id, weekday, opensAt: "09:00", closesAt: "19:00", closed: weekday === 0 },
    });
  }

  const shop2 = await prisma.barbershop.create({
    data: { name: "Barber King", address: "Av. Paulista, 900 - Bela Vista", phone: "(11) 98888-2222" },
  });
  const barbers2 = await Promise.all(
    ["Lucas", "Bruno"].map((name) => prisma.barber.create({ data: { barbershopId: shop2.id, name } }))
  );
  await Promise.all(
    [
      ["Corte Masculino", 5000, 40],
      ["Barba Completa", 3000, 25],
      ["Corte + Barba", 7500, 65],
      ["Platinado", 12000, 90],
    ].map(([name, price, duration]) =>
      prisma.service.create({ data: { barbershopId: shop2.id, name: name as string, priceCents: price as number, durationMin: duration as number } })
    )
  );
  for (let weekday = 0; weekday <= 6; weekday++) {
    await prisma.businessHours.create({
      data: { barbershopId: shop2.id, weekday, opensAt: "10:00", closesAt: "20:00", closed: weekday === 0 },
    });
  }

  return { shop1, barbers1, shop2, barbers2 };
}

async function seedUsers() {
  const count = await prisma.user.count();
  if (count > 0) return;

  const passwordHash = hashPassword(DEMO_PASSWORD);
  const credentials: { username: string; role: string; shop: string; barber?: string }[] = [];

  for (const shop of await prisma.barbershop.findMany({ orderBy: { id: "asc" } })) {
    const ownerUsername = `${slugify(shop.name)}.dono`;
    await prisma.user.create({
      data: { barbershopId: shop.id, role: "owner", username: ownerUsername, passwordHash, name: `Dono(a) da ${shop.name}` },
    });
    credentials.push({ username: ownerUsername, role: "owner", shop: shop.name });

    for (const barber of await prisma.barber.findMany({ where: { barbershopId: shop.id } })) {
      const username = slugify(barber.name);
      await prisma.user.create({
        data: { barbershopId: shop.id, barberId: barber.id, role: "barber", username, passwordHash, name: barber.name },
      });
      credentials.push({ username, role: "barber", shop: shop.name, barber: barber.name });
    }
  }

  console.log(`\n=== Usuários de demonstração criados (senha para todos: ${DEMO_PASSWORD}) ===`);
  for (const c of credentials) {
    console.log(`  ${c.username.padEnd(24)} [${c.role.padEnd(6)}] ${c.shop}${c.barber ? " — " + c.barber : ""}`);
  }
  console.log("Troque essas senhas antes de usar em produção.\n");
}

async function findOrCreateClient(name: string, phone: string) {
  const existing = await prisma.client.findUnique({ where: { phone } });
  if (existing) return existing;
  return prisma.client.create({ data: { name, phone } });
}

async function seedHistoricalData() {
  const count = await prisma.appointment.count();
  if (count >= 15) return;

  const clientPool = await Promise.all(
    CLIENT_NAMES.map((name, i) => findOrCreateClient(name, `1191${(300000 + i).toString()}`))
  );

  const DAYS_BACK = 75;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const shop of await prisma.barbershop.findMany({ orderBy: { id: "asc" } })) {
    const barbers = await prisma.barber.findMany({ where: { barbershopId: shop.id, active: true } });
    const services = await prisma.service.findMany({ where: { barbershopId: shop.id, active: true } });
    if (barbers.length === 0 || services.length === 0) continue;

    async function scheduleRandom(
      dateStr: string,
      busy: Record<number, { start: number; end: number }[]>,
      openMin: number,
      closeMin: number,
      restrictStart?: number,
      restrictEnd?: number
    ): Promise<boolean> {
      const barber = barbers[Math.floor(Math.random() * barbers.length)]!;
      const service = services[Math.floor(Math.random() * services.length)]!;
      const lo = restrictStart ?? openMin;
      const hi = restrictEnd ?? closeMin;
      const maxStart = hi - service.durationMin;
      if (maxStart < lo) return false;
      const slotCount = Math.max(1, Math.floor((maxStart - lo) / 30) + 1);
      for (let attempt = 0; attempt < 6; attempt++) {
        const start = lo + Math.floor(Math.random() * slotCount) * 30;
        const end = start + service.durationMin;
        if (end > hi) continue;
        const list = busy[barber.id] || [];
        if (list.some((b) => start < b.end && end > b.start)) continue;
        busy[barber.id] = [...list, { start, end }];
        const clientRow = clientPool[Math.floor(Math.random() * clientPool.length)]!;
        await prisma.appointment.create({
          data: {
            barbershopId: shop.id,
            barberId: barber.id,
            serviceId: service.id,
            clientId: clientRow.id,
            date: new Date(`${dateStr}T00:00:00`),
            startTime: minutesToTime(start),
            endTime: minutesToTime(end),
          },
        });
        return true;
      }
      return false;
    }

    for (let offset = DAYS_BACK; offset >= 1; offset--) {
      const day = new Date(today);
      day.setDate(day.getDate() - offset);
      const dateStr = localDateStr(day);
      const hours = await prisma.businessHours.findUnique({
        where: { barbershopId_weekday: { barbershopId: shop.id, weekday: day.getDay() } },
      });
      if (!hours || hours.closed) continue;
      const openMin = timeToMinutes(hours.opensAt);
      const closeMin = timeToMinutes(hours.closesAt);
      const apptCount = 3 + Math.floor(Math.random() * 7);
      // Resetado a cada dia — cada dia tem sua própria agenda, não deve
      // acumular "ocupado" com dias anteriores.
      const busyDay: Record<number, { start: number; end: number }[]> = {};
      for (let n = 0; n < apptCount; n++) await scheduleRandom(dateStr, busyDay, openMin, closeMin);
    }

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todayStr = localDateStr(today);
    const todayHours = await prisma.businessHours.findUnique({
      where: { barbershopId_weekday: { barbershopId: shop.id, weekday: today.getDay() } },
    });
    const busyToday: Record<number, { start: number; end: number }[]> = {};

    if (todayHours && !todayHours.closed) {
      const openMin = timeToMinutes(todayHours.opensAt);
      const closeMin = timeToMinutes(todayHours.closesAt);

      if (nowMin > openMin + 10 && nowMin < closeMin - 10) {
        await scheduleRandom(todayStr, busyToday, openMin, closeMin, Math.max(openMin, nowMin - 15), Math.min(closeMin, nowMin + 5));
      }
      if (nowMin > openMin + 30) {
        const completedCount = 2 + Math.floor(Math.random() * 2);
        for (let n = 0; n < completedCount; n++) {
          await scheduleRandom(todayStr, busyToday, openMin, closeMin, openMin, Math.min(nowMin, closeMin));
        }
      }
      if (nowMin < closeMin - 30) {
        const upcomingCount = 3 + Math.floor(Math.random() * 3);
        for (let n = 0; n < upcomingCount; n++) {
          await scheduleRandom(todayStr, busyToday, openMin, closeMin, Math.max(openMin, nowMin + 20), closeMin);
        }
      }
    }
  }
}

async function main() {
  await seedShops();
  await seedUsers();
  await seedHistoricalData();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
