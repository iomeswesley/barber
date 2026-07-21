import { getAppointments } from "@/modules/appointments/appointments.repository.js";
import { getBarbers } from "@/modules/barbers/barbers.repository.js";
import { getBusinessHours } from "@/modules/barbershops/barbershops.repository.js";
import { getProductSalesRevenue, getProductSalesWithAppointment } from "@/modules/products/products.repository.js";
import { localDateStr, timeToMinutes, weekdayForDateStr } from "@/lib/time.js";
import type { AppointmentDTO } from "@/modules/appointments/appointments.types.js";

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function monthKey(dateString: string): string {
  return dateString.slice(0, 7); // YYYY-MM
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

function groupSum<T>(rows: T[], keyFn: (r: T) => string, valFn: (r: T) => number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = keyFn(r);
    out[k] = (out[k] || 0) + valFn(r);
  }
  return out;
}

function pctGrowth(current: number, previous: number): number {
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function goalProgress(currentValue: number, goalCents: number): number | null {
  if (!goalCents) return null;
  const goal = goalCents / 100;
  return Math.min(100, Math.round((currentValue / goal) * 100));
}

function monthDateRange(now: Date) {
  const from = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  return { from, to: localDateStr(now) };
}

// month é "YYYY-MM". Range cobre o mês inteiro, limitado a hoje pra dias futuros
// (que ainda não aconteceram) não contarem como faturamento.
function monthRange(month: string) {
  const [year, mon] = month.split("-").map(Number);
  const from = `${month}-01`;
  const lastDay = new Date(year!, mon!, 0).getDate();
  const to = `${month}-${pad(lastDay)}`;
  const today = localDateStr(new Date());
  return { from, to: to > today ? today : to };
}

// Venda de produto não tem barbeiro próprio no schema — só dá pra atribuir
// via o agendamento vinculado (appointmentId). Venda avulsa sem agendamento
// fica de fora (não dá pra saber quem atendeu), mas continua contando na
// receita bruta total normalmente, só não gera comissão de produto pra
// ninguém específico. Reaproveitado em getDashboardSummary,
// getMonthlyFinancialTrend, getBarberOwnSummary e getBarberPerformance.
async function productRevenueCentsByBarberId(
  barbershopId: number,
  appointmentsInScope: AppointmentDTO[],
  dateFrom: string,
  dateTo: string
): Promise<Map<number, number>> {
  const barberIdByAppointmentId = new Map(appointmentsInScope.map((a) => [a.id, a.barberId]));
  const sales = await getProductSalesWithAppointment(barbershopId, { dateFrom, dateTo });
  const map = new Map<number, number>();
  for (const sale of sales) {
    const barberId = barberIdByAppointmentId.get(sale.appointmentId);
    if (barberId == null) continue;
    map.set(barberId, (map.get(barberId) || 0) + sale.amountCents);
  }
  return map;
}

function sumMapValues(map: Map<number, number>): number {
  return sum([...map.values()]);
}

// Comissão de produto só é devida sobre a parte atribuída a um barbeiro (ver
// productRevenueCentsByBarberId) — venda avulsa sem agendamento nunca gera
// comissão pra ninguém, mas segue contando na receita bruta.
function productCommissionCentsFor(productRevenueByBarberId: Map<number, number>, productCommissionPercentByBarberId: Record<number, number>): number {
  let total = 0;
  for (const [barberId, cents] of productRevenueByBarberId) {
    total += (cents * (productCommissionPercentByBarberId[barberId] ?? 0)) / 100;
  }
  return total;
}

export async function getDashboardSummary(barbershopId: number) {
  const now = new Date();
  // A meta da barbearia toda não é setada diretamente — é a soma da meta de cada
  // barbeiro ativo, então existe um único lugar (as configs do próprio barbeiro)
  // pra manter isso consistente.
  const barbersAll = await getBarbers(barbershopId, { includeInactive: true });
  const barbersActive = await getBarbers(barbershopId);
  const shopGoalCents = sum(barbersActive.map((b) => b.monthlyGoalCents));
  // Comissão de serviço é devida por barbeiro sobre serviços realizados (ou
  // agendados, pra previsão); comissão de produto usa uma taxa separada,
  // sobre a parte de venda de produto atribuída a esse barbeiro via
  // agendamento vinculado (ver productRevenueCentsByBarberId).
  const serviceCommissionPercentByBarberId = Object.fromEntries(barbersAll.map((b) => [b.id, Number(b.serviceCommissionPercent)]));
  const productCommissionPercentByBarberId = Object.fromEntries(barbersAll.map((b) => [b.id, Number(b.productCommissionPercent)]));
  const commissionCentsFor = (rows: AppointmentDTO[]) =>
    sum(rows.map((a) => (a.priceCents * (serviceCommissionPercentByBarberId[a.barberId] ?? 0)) / 100));

  // No-shows nunca geraram receita, então são excluídos de todas as figuras
  // financeiras aqui — consistente com a aba Histórico, que filtra do mesmo jeito.
  const all = (await getAppointments({ barbershopId })).filter((a) => a.status !== "no_show");

  const thisMonthKey = monthKey(localDateStr(now));
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthKey = monthKey(localDateStr(lastMonthDate));

  const thisMonth = all.filter((a) => a.date.slice(0, 7) === thisMonthKey);
  const lastMonth = all.filter((a) => a.date.slice(0, 7) === lastMonthKey);
  // Compara "mês até hoje" contra o mesmo número de dias do mês passado — senão
  // um mês atual parcial sempre parece uma queda vs. um mês passado inteiro.
  const lastMonthMTD = lastMonth.filter((a) => Number(a.date.slice(8, 10)) <= now.getDate());

  const endDateTime = (a: AppointmentDTO) => new Date(`${a.date}T${a.endTime}:00`);
  const realizedThisMonth = thisMonth.filter((a) => endDateTime(a) <= now);

  const { from: monthFrom, to: monthTo } = monthDateRange(now);
  const productRevenueByBarberIdThisMonth = await productRevenueCentsByBarberId(barbershopId, thisMonth, monthFrom, monthTo);
  const productRevenueThisMonth = sumMapValues(productRevenueByBarberIdThisMonth) / 100;
  const productCommissionCentsThisMonth = productCommissionCentsFor(productRevenueByBarberIdThisMonth, productCommissionPercentByBarberId);

  // "Previsão" = tudo agendado neste mês, realizado ou não.
  // "Faturamento" = só o que já foi concluído (produtos sempre são transações
  // já concluídas, então contam pros dois).
  const revenueRealizedThisMonth = sum(realizedThisMonth.map((a) => a.priceCents)) / 100;
  const previsaoBruto = sum(thisMonth.map((a) => a.priceCents)) / 100 + productRevenueThisMonth;
  const faturamentoBruto = revenueRealizedThisMonth + productRevenueThisMonth;
  const previsaoLiquido = previsaoBruto - commissionCentsFor(thisMonth) / 100 - productCommissionCentsThisMonth / 100;
  const faturamentoLiquido = faturamentoBruto - commissionCentsFor(realizedThisMonth) / 100 - productCommissionCentsThisMonth / 100;

  const lastMonthDaysInMonth = new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth() + 1, 0).getDate();
  const lastMonthCutoffDay = Math.min(now.getDate(), lastMonthDaysInMonth);
  const lastMonthFrom = `${lastMonthKey}-01`;
  const lastMonthTo = `${lastMonthKey}-${pad(lastMonthCutoffDay)}`;
  const productRevenueByBarberIdLastMonth = await productRevenueCentsByBarberId(barbershopId, lastMonthMTD, lastMonthFrom, lastMonthTo);
  const productRevenueLastMonth = sumMapValues(productRevenueByBarberIdLastMonth) / 100;
  const productCommissionCentsLastMonth = productCommissionCentsFor(productRevenueByBarberIdLastMonth, productCommissionPercentByBarberId);
  const revenueLastMonthServiceOnly = sum(lastMonthMTD.map((a) => a.priceCents)) / 100;
  const revenueLastMonth = revenueLastMonthServiceOnly + productRevenueLastMonth;
  const liquidoLastMonth = revenueLastMonth - commissionCentsFor(lastMonthMTD) / 100 - productCommissionCentsLastMonth / 100;

  const countRealizedThisMonth = realizedThisMonth.length;
  const countRealizedLastMonth = lastMonthMTD.length;

  const avgTicketThisMonth = countRealizedThisMonth ? revenueRealizedThisMonth / countRealizedThisMonth : 0;
  const avgTicketLastMonth = countRealizedLastMonth ? revenueLastMonthServiceOnly / countRealizedLastMonth : 0;

  const rawThisMonth = (await getAppointments({ barbershopId })).filter((a) => a.date.slice(0, 7) === thisMonthKey);
  const noShowCountThisMonth = rawThisMonth.filter((a) => a.status === "no_show").length;
  const noShowRate =
    noShowCountThisMonth + countRealizedThisMonth
      ? Math.round((noShowCountThisMonth / (noShowCountThisMonth + countRealizedThisMonth)) * 1000) / 10
      : 0;

  const byBarber = groupSum(thisMonth, (a) => a.barberName, (a) => a.priceCents);
  let barberOfMonth: string | null = null;
  let topRevenue = -1;
  for (const [name, revenue] of Object.entries(byBarber)) {
    if (revenue > topRevenue) {
      topRevenue = revenue;
      barberOfMonth = name;
    }
  }
  const barberOfMonthCount = thisMonth.filter((a) => a.barberName === barberOfMonth).length;

  return {
    revenueThisMonth: previsaoBruto,
    revenueLastMonth,
    revenueGrowthPercent: pctGrowth(previsaoBruto, revenueLastMonth),

    faturamentoBruto,
    faturamentoBrutoGrowthPercent: pctGrowth(faturamentoBruto, revenueLastMonth),
    faturamentoLiquido,
    faturamentoLiquidoGrowthPercent: pctGrowth(faturamentoLiquido, liquidoLastMonth),
    previsaoBruto,
    previsaoBrutoGrowthPercent: pctGrowth(previsaoBruto, revenueLastMonth),
    previsaoLiquido,
    previsaoLiquidoGrowthPercent: pctGrowth(previsaoLiquido, liquidoLastMonth),

    countRealizedThisMonth,
    countRealizedLastMonth,
    countGrowthPercent: pctGrowth(countRealizedThisMonth, countRealizedLastMonth),
    avgTicketThisMonth,
    avgTicketLastMonth,
    avgTicketGrowthPercent: pctGrowth(avgTicketThisMonth, avgTicketLastMonth),
    barberOfMonth: barberOfMonth ? { name: barberOfMonth, revenue: topRevenue / 100, count: barberOfMonthCount } : null,
    noShowCountThisMonth,
    noShowRate,
    monthlyGoal: shopGoalCents / 100,
    monthlyGoalPercent: goalProgress(previsaoBruto, shopGoalCents),
  };
}

// Tendência mês a mês dos quatro KPIs de receita, pros mini-gráficos dos cards
// da visão geral. Meses passados são sempre totalmente "realizados", então
// bruto/líquido naturalmente igualam previsãoBruto/previsãoLíquido, exceto no mês atual.
export async function getMonthlyFinancialTrend(barbershopId: number, months = 6) {
  const now = new Date();
  const barbersAll = await getBarbers(barbershopId, { includeInactive: true });
  const serviceCommissionPercentByBarberId = Object.fromEntries(barbersAll.map((b) => [b.id, Number(b.serviceCommissionPercent)]));
  const productCommissionPercentByBarberId = Object.fromEntries(barbersAll.map((b) => [b.id, Number(b.productCommissionPercent)]));
  const commissionCentsFor = (rows: AppointmentDTO[]) =>
    sum(rows.map((a) => (a.priceCents * (serviceCommissionPercentByBarberId[a.barberId] ?? 0)) / 100));

  const all = (await getAppointments({ barbershopId })).filter((a) => a.status !== "no_show");
  const endDateTime = (a: AppointmentDTO) => new Date(`${a.date}T${a.endTime}:00`);

  const result = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mKey = monthKey(localDateStr(d));
    const monthAppts = all.filter((a) => a.date.slice(0, 7) === mKey);
    const realized = monthAppts.filter((a) => endDateTime(a) <= now);
    const { from, to } = monthRange(mKey);
    const productRevenueByBarberId = await productRevenueCentsByBarberId(barbershopId, monthAppts, from, to);
    const productRevenue = sumMapValues(productRevenueByBarberId) / 100;
    const productCommissionCents = productCommissionCentsFor(productRevenueByBarberId, productCommissionPercentByBarberId);

    const bruto = sum(realized.map((a) => a.priceCents)) / 100 + productRevenue;
    const previsaoBruto = sum(monthAppts.map((a) => a.priceCents)) / 100 + productRevenue;
    const liquido = bruto - commissionCentsFor(realized) / 100 - productCommissionCents / 100;
    const previsaoLiquido = previsaoBruto - commissionCentsFor(monthAppts) / 100 - productCommissionCents / 100;

    result.push({ month: mKey, bruto, liquido, previsaoBruto, previsaoLiquido });
  }
  return result;
}

export async function getBarberOwnSummary(barbershopId: number, barberId: number) {
  const now = new Date();
  const barbersAll = await getBarbers(barbershopId, { includeInactive: true });
  const barber = barbersAll.find((b) => b.id === barberId);
  const all = (await getAppointments({ barbershopId, barberId })).filter((a) => a.status !== "no_show");

  const thisMonthKey = monthKey(localDateStr(now));
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthKey = monthKey(localDateStr(lastMonthDate));

  const thisMonth = all.filter((a) => a.date.slice(0, 7) === thisMonthKey);
  const lastMonth = all.filter((a) => a.date.slice(0, 7) === lastMonthKey);
  const lastMonthMTD = lastMonth.filter((a) => Number(a.date.slice(8, 10)) <= now.getDate());

  const endDateTime = (a: AppointmentDTO) => new Date(`${a.date}T${a.endTime}:00`);
  const realizedThisMonth = thisMonth.filter((a) => endDateTime(a) <= now);

  const { from: monthFrom, to: monthTo } = monthDateRange(now);
  const productRevenueMapThisMonth = await productRevenueCentsByBarberId(barbershopId, thisMonth, monthFrom, monthTo);
  const productRevenueThisMonth = (productRevenueMapThisMonth.get(barberId) || 0) / 100;

  const lastMonthDaysInMonth = new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth() + 1, 0).getDate();
  const lastMonthCutoffDay = Math.min(now.getDate(), lastMonthDaysInMonth);
  const productRevenueMapLastMonth = await productRevenueCentsByBarberId(
    barbershopId,
    lastMonthMTD,
    `${lastMonthKey}-01`,
    `${lastMonthKey}-${pad(lastMonthCutoffDay)}`
  );
  const productRevenueLastMonth = (productRevenueMapLastMonth.get(barberId) || 0) / 100;

  const serviceRevenueThisMonth = sum(thisMonth.map((a) => a.priceCents)) / 100;
  const serviceRevenueLastMonth = sum(lastMonthMTD.map((a) => a.priceCents)) / 100;
  const revenueThisMonth = serviceRevenueThisMonth + productRevenueThisMonth;
  const revenueLastMonth = serviceRevenueLastMonth + productRevenueLastMonth;

  const countRealizedThisMonth = realizedThisMonth.length;
  const countRealizedLastMonth = lastMonthMTD.length;

  const revenueRealizedThisMonth = sum(realizedThisMonth.map((a) => a.priceCents)) / 100;
  const avgTicketThisMonth = countRealizedThisMonth ? revenueRealizedThisMonth / countRealizedThisMonth : 0;

  const serviceCommissionPercent = barber ? Number(barber.serviceCommissionPercent) : 0;
  const productCommissionPercent = barber ? Number(barber.productCommissionPercent) : 0;
  const serviceCommissionEarned = (serviceRevenueThisMonth * serviceCommissionPercent) / 100;
  const productCommissionEarned = (productRevenueThisMonth * productCommissionPercent) / 100;

  return {
    revenueThisMonth,
    revenueGrowthPercent: pctGrowth(revenueThisMonth, revenueLastMonth),
    countRealizedThisMonth,
    countGrowthPercent: pctGrowth(countRealizedThisMonth, countRealizedLastMonth),
    avgTicketThisMonth,
    serviceCommissionPercent,
    productCommissionPercent,
    serviceCommissionEarned,
    productCommissionEarned,
    commissionEarned: serviceCommissionEarned + productCommissionEarned,
    monthlyGoal: (barber?.monthlyGoalCents ?? 0) / 100,
    monthlyGoalPercent: goalProgress(revenueThisMonth, barber?.monthlyGoalCents ?? 0),
  };
}

export async function getRevenueDaily(barbershopId: number, range: string) {
  const now = new Date();
  let days: number;
  if (range === "week") days = 7;
  else if (range === "3months") days = 90;
  else days = 30; // "month"

  const all = (await getAppointments({ barbershopId })).filter((a) => a.status !== "no_show");
  const byDate = groupSum(all, (a) => a.date, (a) => a.priceCents);
  const productsByDate = groupSum(await getProductSalesRevenue(barbershopId, {}), (p) => p.date, (p) => p.amountCents);

  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const ds = localDateStr(d);
    result.push({ date: ds, revenue: Math.round((byDate[ds] || 0) + (productsByDate[ds] || 0)) / 100 });
  }
  return result;
}

// Taxa de ocupação por hora do dia, pra cada dia da semana. Pra cada bucket
// de 1h dentro do horário de funcionamento daquele dia, soma quantos minutos
// ficaram ocupados por agendamentos vs. quantos minutos estavam disponíveis
// (nº de barbeiros ativos × horas abertas naquele bucket, somando todas as
// ocorrências daquele dia da semana dentro do período) — dá um % que já
// pondera agendamentos mais curtos que 1h corretamente. Dias marcados como
// fechado nas configurações simplesmente não aparecem no resultado.
export async function getOccupancyByHour(barbershopId: number, range: string) {
  const now = new Date();
  let days: number;
  if (range === "week") days = 7;
  else if (range === "3months") days = 90;
  else days = 30; // "month"

  const weekHours = await getBusinessHours(barbershopId);
  const hoursByWeekday = new Map(weekHours.map((h) => [h.weekday, h]));
  const barbers = await getBarbers(barbershopId);
  const barberCount = Math.max(barbers.length, 1);

  // Range de horas próprio de cada dia da semana (dias diferentes podem abrir
  // em horários diferentes).
  const hourRangeByWeekday = new Map<number, { min: number; max: number }>();
  for (const h of weekHours) {
    if (h.closed) continue;
    const openH = Math.floor(timeToMinutes(h.opensAt) / 60);
    const closeMin = timeToMinutes(h.closesAt);
    const closeH = closeMin % 60 > 0 ? Math.floor(closeMin / 60) + 1 : closeMin / 60;
    hourRangeByWeekday.set(h.weekday, { min: openH, max: closeH });
  }

  const dateList: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dateList.push(localDateStr(d));
  }
  if (dateList.length === 0 || hourRangeByWeekday.size === 0) return [];

  const occupied = new Map<string, number>(); // key: "weekday-hour"
  const available = new Map<string, number>();

  for (const dateStr of dateList) {
    const weekday = weekdayForDateStr(dateStr);
    const bh = hoursByWeekday.get(weekday);
    const hourRange = hourRangeByWeekday.get(weekday);
    if (!bh || bh.closed || !hourRange) continue;
    const openMin = timeToMinutes(bh.opensAt);
    const closeMin = timeToMinutes(bh.closesAt);
    for (let h = hourRange.min; h < hourRange.max; h++) {
      const overlapMin = Math.max(0, Math.min((h + 1) * 60, closeMin) - Math.max(h * 60, openMin));
      const key = `${weekday}-${h}`;
      available.set(key, (available.get(key) || 0) + overlapMin * barberCount);
    }
  }

  const dateSet = new Set(dateList);
  const appts = (
    await getAppointments({ barbershopId, dateFrom: dateList[0], dateTo: dateList[dateList.length - 1] })
  ).filter((a) => a.status !== "no_show" && dateSet.has(a.date));
  for (const a of appts) {
    const weekday = weekdayForDateStr(a.date);
    const hourRange = hourRangeByWeekday.get(weekday);
    if (!hourRange) continue;
    const startMin = timeToMinutes(a.startTime);
    const endMin = timeToMinutes(a.endTime);
    for (let h = hourRange.min; h < hourRange.max; h++) {
      const overlapMin = Math.max(0, Math.min(endMin, (h + 1) * 60) - Math.max(startMin, h * 60));
      if (overlapMin > 0) {
        const key = `${weekday}-${h}`;
        occupied.set(key, (occupied.get(key) || 0) + overlapMin);
      }
    }
  }

  const result: { weekday: number; hour: number; occupancyPercent: number }[] = [];
  for (let weekday = 0; weekday <= 6; weekday++) {
    const hourRange = hourRangeByWeekday.get(weekday);
    if (!hourRange) continue; // fechado — não aparece
    for (let h = hourRange.min; h < hourRange.max; h++) {
      const key = `${weekday}-${h}`;
      const avail = available.get(key) || 0;
      if (avail <= 0) continue;
      const occ = occupied.get(key) || 0;
      result.push({ weekday, hour: h, occupancyPercent: Math.min(100, Math.round((occ / avail) * 100)) });
    }
  }
  return result;
}

export async function getBarberPerformance(barbershopId: number) {
  const now = new Date();
  const barbers = await getBarbers(barbershopId);
  const all = (await getAppointments({ barbershopId })).filter((a) => a.status !== "no_show");
  const thisMonthKey = monthKey(localDateStr(now));
  const thisMonth = all.filter((a) => a.date.slice(0, 7) === thisMonthKey);

  // Horários agora podem diferir por dia da semana, então o tempo disponível é
  // somado dia a dia em vez de uma duração diária fixa vezes contagem de dias úteis.
  // Busca as 7 linhas de horário de uma vez só (em vez de uma query por dia do mês)
  // — isso rodava até 31 idas e voltas sequenciais ao banco por requisição, o que
  // sobre a rede (Postgres remoto) ficava lento o bastante pro frontend achar que
  // a sessão tinha expirado.
  const year = now.getFullYear();
  const month = now.getMonth();
  const weekHours = await getBusinessHours(barbershopId);
  const hoursByWeekday = new Map(weekHours.map((h) => [h.weekday, h]));
  let availableMinutes = 0;
  for (let day = 1; day <= now.getDate(); day++) {
    const d = new Date(year, month, day);
    const hours = hoursByWeekday.get(d.getDay());
    if (!hours || hours.closed) continue;
    availableMinutes += timeToMinutes(hours.closesAt) - timeToMinutes(hours.opensAt);
  }
  availableMinutes = Math.max(availableMinutes, 1);

  const { from: monthFrom, to: monthTo } = monthDateRange(now);
  const productRevenueByBarberId = await productRevenueCentsByBarberId(barbershopId, thisMonth, monthFrom, monthTo);

  return barbers
    .map((b) => {
      const rows = thisMonth.filter((a) => a.barberId === b.id);
      const revenue = sum(rows.map((a) => a.priceCents)) / 100;
      const productRevenue = (productRevenueByBarberId.get(b.id) || 0) / 100;
      const count = rows.length;
      const bookedMinutes = sum(rows.map((a) => a.durationMin));
      const occupancyPercent = Math.min(100, Math.round((bookedMinutes / availableMinutes) * 100));
      return {
        id: b.id,
        name: b.name,
        revenue,
        productRevenue,
        count,
        occupancyPercent,
        monthlyGoal: b.monthlyGoalCents / 100,
        monthlyGoalPercent: goalProgress(revenue, b.monthlyGoalCents),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

export function computeApptStatus(a: AppointmentDTO, now = new Date()): string {
  if (a.status === "no_show") return "nao_compareceu";
  const start = new Date(`${a.date}T${a.startTime}:00`);
  const end = new Date(`${a.date}T${a.endTime}:00`);
  if (now >= end) return "concluido";
  if (now >= start) return "em_andamento";
  return "confirmado";
}

export async function getTodayAppointments(barbershopId: number) {
  const now = new Date();
  const todayStr = localDateStr(now);
  const all = await getAppointments({ barbershopId, date: todayStr });

  return all
    .map((a) => ({ ...a, computedStatus: computeApptStatus(a, now) }))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export async function getAppointmentsInRange(barbershopId: number, barberId: number | undefined, dateFrom: string, dateTo: string) {
  const now = new Date();
  const all = await getAppointments({ barbershopId, barberId, dateFrom, dateTo });
  return all
    .map((a) => ({ ...a, computedStatus: computeApptStatus(a, now) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

function periodDateFrom(period?: string): string | null {
  const now = new Date();
  if (period === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return localDateStr(d);
  }
  if (period === "month") {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    return localDateStr(d);
  }
  if (period === "3months") {
    const d = new Date(now);
    d.setDate(d.getDate() - 90);
    return localDateStr(d);
  }
  return null; // "all"
}

export async function getHistory(
  barbershopId: number,
  { period, barberId, month }: { period?: string; barberId?: number; month?: string } = {}
) {
  const now = new Date();
  const { dateFrom, dateTo } = month
    ? (() => {
        const r = monthRange(month);
        return { dateFrom: r.from, dateTo: r.to };
      })()
    : { dateFrom: periodDateFrom(period) ?? undefined, dateTo: localDateStr(now) };
  const all = await getAppointments({ barbershopId, barberId, dateFrom, dateTo });
  const realized = all.filter((a) => computeApptStatus(a, now) === "concluido");

  const revenueByBarber = groupSum(realized, (a) => a.barberName, (a) => a.priceCents);
  const revenueByService = groupSum(realized, (a) => a.serviceName, (a) => a.priceCents);

  // Vendas de produto não são atribuídas a um barbeiro específico, então só
  // entram nos totais da barbearia toda (não aparecem ao filtrar por barbeiro).
  const productRevenue = barberId
    ? 0
    : sum((await getProductSalesRevenue(barbershopId, { dateFrom, dateTo })).map((p) => p.amountCents)) / 100;

  const serviceRevenue = sum(realized.map((a) => a.priceCents)) / 100;

  return {
    totalRevenue: serviceRevenue + productRevenue,
    totalCount: realized.length,
    byBarber: Object.entries(revenueByBarber).map(([name, revenue]) => ({ name, revenue: revenue / 100 })),
    byService: Object.entries(revenueByService).map(([name, revenue]) => ({ name, revenue: revenue / 100 })),
  };
}
