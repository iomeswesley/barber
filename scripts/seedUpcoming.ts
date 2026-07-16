// Script avulso (não faz parte do build/deploy) pra popular agendamentos de
// hoje em diante em todas as barbearias, pra simular melhor o painel com
// agenda futura. Roda direto contra o banco configurado em .env.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DAYS_FORWARD = 12;
const CLIENT_NAMES = [
  "Pedro Almeida", "Lucas Ferreira", "Matheus Costa", "Gabriel Souza", "Rafael Lima",
  "Bruno Alves", "Thiago Rocha", "Felipe Martins", "André Nascimento", "Rodrigo Cardoso",
  "Vinícius Teixeira", "Gustavo Ribeiro", "Leonardo Pereira", "Marcelo Gomes", "Fernando Dias",
  "Eduardo Correia", "Renato Vieira", "Alexandre Moura", "Daniel Castro", "João Pedro",
  "Miguel Santos", "Arthur Oliveira", "Enzo Fernandes", "Davi Cavalcanti", "Otávio Ramos",
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
  return prisma.client.create({ data: { name, phone } });
}

async function main() {
  const clientPool = await Promise.all(
    CLIENT_NAMES.map((name, i) => findOrCreateClient(name, `1191${(300000 + i).toString()}`))
  );

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let totalCreated = 0;

  for (const shop of await prisma.barbershop.findMany({ orderBy: { id: "asc" } })) {
    const barbers = await prisma.barber.findMany({ where: { barbershopId: shop.id, active: true } });
    const services = await prisma.service.findMany({ where: { barbershopId: shop.id, active: true } });
    if (barbers.length === 0 || services.length === 0) {
      console.log(`(pulando ${shop.name}: sem barbeiros/serviços ativos)`);
      continue;
    }

    for (let offset = 0; offset <= DAYS_FORWARD; offset++) {
      const day = new Date(today);
      day.setDate(day.getDate() + offset);
      const dateStr = localDateStr(day);
      const isToday = offset === 0;

      const hours = await prisma.businessHours.findUnique({
        where: { barbershopId_weekday: { barbershopId: shop.id, weekday: day.getDay() } },
      });
      if (!hours || hours.closed) continue;

      const openMin = timeToMinutes(hours.opensAt);
      const closeMin = timeToMinutes(hours.closesAt);
      // Hoje, só marca a partir de agora + 15min (não faz sentido criar
      // agendamento "futuro" no passado do próprio dia).
      const lo = isToday ? Math.max(openMin, nowMin + 15) : openMin;
      if (lo >= closeMin) continue;

      // Carrega o que já existe nesse dia pra não duplicar em cima de
      // agendamentos que já foram criados antes (pelo seed original ou por
      // uma rodada anterior deste script).
      const existing = await prisma.appointment.findMany({
        where: { barbershopId: shop.id, date: new Date(`${dateStr}T00:00:00`), status: { not: "cancelled" } },
      });
      const busy: Record<number, { start: number; end: number }[]> = {};
      for (const a of existing) {
        const list = busy[a.barberId] || [];
        list.push({ start: timeToMinutes(a.startTime), end: timeToMinutes(a.endTime) });
        busy[a.barberId] = list;
      }

      const apptCount = 4 + Math.floor(Math.random() * 5); // 4 a 8 por dia
      for (let n = 0; n < apptCount; n++) {
        const barber = barbers[Math.floor(Math.random() * barbers.length)]!;
        const service = services[Math.floor(Math.random() * services.length)]!;
        const maxStart = closeMin - service.durationMin;
        if (maxStart < lo) continue;
        const slotCount = Math.max(1, Math.floor((maxStart - lo) / 30) + 1);

        let placed = false;
        for (let attempt = 0; attempt < 8 && !placed; attempt++) {
          const start = lo + Math.floor(Math.random() * slotCount) * 30;
          const end = start + service.durationMin;
          if (end > closeMin) continue;
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
          totalCreated++;
          placed = true;
        }
      }
    }
    console.log(`${shop.name}: agendamentos futuros criados até agora — total acumulado ${totalCreated}`);
  }

  console.log(`\nTotal de agendamentos criados: ${totalCreated}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
