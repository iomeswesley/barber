import { prisma } from "@/lib/prisma.js";
import { localDateStr } from "@/lib/time.js";

export interface ClientStatsRow {
  id: number;
  name: string;
  phone: string;
  birthday: Date | null;
  visitCount: number;
  totalRevenueCents: number;
  lastVisitDate: string | null;
  avgFrequencyDays: number | null;
  dueStatus: "atrasado" | "em_dia" | null;
}

// Calculado em JS (em vez de uma única query SQL agregada) pra manter a lógica de
// negócio (frequência média, status "atrasado") legível e fácil de auditar —
// o volume de agendamentos por barbearia é pequeno o bastante pra isso não pesar.
export async function getClientStats(barbershopId: number): Promise<ClientStatsRow[]> {
  const now = new Date();
  const nowStr = `${localDateStr(now)} ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

  const appointments = await prisma.appointment.findMany({
    where: { barbershopId, status: { not: "cancelled" } },
    include: { client: true, service: { select: { priceCents: true } } },
  });

  const isCompleted = (date: Date, endTime: string) => `${localDateStr(date)} ${endTime}` <= nowStr;

  const byClient = new Map<number, { client: (typeof appointments)[number]["client"]; rows: typeof appointments }>();
  for (const a of appointments) {
    if (!byClient.has(a.clientId)) byClient.set(a.clientId, { client: a.client, rows: [] });
    byClient.get(a.clientId)!.rows.push(a);
  }

  const productRevenueByClient = new Map<number, number>();
  const sales = await prisma.productSale.findMany({
    where: { barbershopId },
    include: { product: { select: { priceCents: true } } },
  });
  for (const s of sales) {
    productRevenueByClient.set(s.clientId, (productRevenueByClient.get(s.clientId) || 0) + s.quantity * s.product.priceCents);
  }

  const todayStr = localDateStr(now);

  const result: ClientStatsRow[] = [];
  for (const { client, rows } of byClient.values()) {
    const completed = rows.filter((a) => a.status === "confirmed" && isCompleted(a.date, a.endTime));
    const visitCount = completed.length;
    const totalRevenueCents = completed.reduce((sum, a) => sum + a.service.priceCents, 0) + (productRevenueByClient.get(client.id) || 0);
    const dates = [...new Set(completed.map((a) => localDateStr(a.date)))].sort();
    const lastVisitDate = dates.length ? dates[dates.length - 1]! : null;

    let avgFrequencyDays: number | null = null;
    if (dates.length >= 2) {
      const first = new Date(dates[0]!);
      const last = new Date(dates[dates.length - 1]!);
      const totalDays = Math.round((last.getTime() - first.getTime()) / 86400000);
      if (totalDays > 0) avgFrequencyDays = Math.round(totalDays / (dates.length - 1));
    }

    let dueStatus: "atrasado" | "em_dia" | null = null;
    if (avgFrequencyDays && lastVisitDate) {
      const expectedNext = new Date(lastVisitDate);
      expectedNext.setDate(expectedNext.getDate() + avgFrequencyDays);
      dueStatus = localDateStr(expectedNext) < todayStr ? "atrasado" : "em_dia";
    }

    result.push({
      id: client.id,
      name: client.name,
      phone: client.phone,
      birthday: client.birthday,
      visitCount,
      totalRevenueCents,
      lastVisitDate,
      avgFrequencyDays,
      dueStatus,
    });
  }

  return result.sort((a, b) => (b.lastVisitDate || "").localeCompare(a.lastVisitDate || ""));
}

export async function getClientVisitHistory(clientId: number, barbershopId: number, limit = 5) {
  return prisma.appointment.findMany({
    where: { clientId, barbershopId, status: { not: "cancelled" } },
    orderBy: [{ date: "desc" }, { startTime: "desc" }],
    take: limit,
    include: {
      service: { select: { name: true, priceCents: true } },
      barber: { select: { name: true } },
      productSales: { include: { product: { select: { name: true, priceCents: true } } } },
    },
  });
}
