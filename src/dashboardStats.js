import { getAppointments, getBarbers, getBarbershop, getProductSalesRevenue, getTotalExpenses } from "./db.js";

function pad(n) {
  return n.toString().padStart(2, "0");
}

function localDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthKey(dateString) {
  return dateString.slice(0, 7); // YYYY-MM
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

function groupSum(rows, keyFn, valFn) {
  const out = {};
  for (const r of rows) {
    const k = keyFn(r);
    out[k] = (out[k] || 0) + valFn(r);
  }
  return out;
}

function pctGrowth(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function goalProgress(currentValue, goalCents) {
  if (!goalCents) return null;
  const goal = goalCents / 100;
  return Math.min(100, Math.round((currentValue / goal) * 100));
}

function monthDateRange(now) {
  const from = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  return { from, to: localDateStr(now) };
}

function toMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function getDashboardSummary(barbershopId) {
  const now = new Date();
  // The shop-wide goal isn't set directly — it's the sum of each active barber's own goal,
  // so there's a single place (the barber's own settings) to keep it consistent.
  const shopGoalCents = sum(getBarbers(barbershopId).map((b) => b.monthly_goal_cents));
  // No-shows never generated revenue, so they're excluded from every financial figure here —
  // keeps this consistent with the Histórico tab, which filters them out the same way.
  const all = getAppointments({ barbershopId }).filter((a) => a.status !== "no_show");

  const thisMonthKey = monthKey(localDateStr(now));
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthKey = monthKey(localDateStr(lastMonthDate));

  const thisMonth = all.filter((a) => a.date.slice(0, 7) === thisMonthKey);
  const lastMonth = all.filter((a) => a.date.slice(0, 7) === lastMonthKey);
  // Compare "month to date" against the same number of days last month —
  // otherwise a partial current month always looks like a decline versus a full past month.
  const lastMonthMTD = lastMonth.filter((a) => Number(a.date.slice(8, 10)) <= now.getDate());

  const endDateTime = (a) => new Date(`${a.date}T${a.end_time}:00`);
  const realizedThisMonth = thisMonth.filter((a) => endDateTime(a) <= now);

  const { from: monthFrom, to: monthTo } = monthDateRange(now);
  const productRevenueThisMonth =
    sum(getProductSalesRevenue(barbershopId, { dateFrom: monthFrom, dateTo: monthTo }).map((p) => p.amount_cents)) /
    100;

  const revenueThisMonth = sum(thisMonth.map((a) => a.price_cents)) / 100 + productRevenueThisMonth;
  const revenueLastMonth = sum(lastMonthMTD.map((a) => a.price_cents)) / 100;

  const countRealizedThisMonth = realizedThisMonth.length;
  const countRealizedLastMonth = lastMonthMTD.length;

  const revenueRealizedThisMonth = sum(realizedThisMonth.map((a) => a.price_cents)) / 100;
  const revenueRealizedLastMonth = revenueLastMonth;

  const avgTicketThisMonth = countRealizedThisMonth
    ? revenueRealizedThisMonth / countRealizedThisMonth
    : 0;
  const avgTicketLastMonth = countRealizedLastMonth
    ? revenueRealizedLastMonth / countRealizedLastMonth
    : 0;

  const byBarber = groupSum(thisMonth, (a) => a.barber_name, (a) => a.price_cents);
  let barberOfMonth = null;
  let topRevenue = -1;
  for (const [name, revenue] of Object.entries(byBarber)) {
    if (revenue > topRevenue) {
      topRevenue = revenue;
      barberOfMonth = name;
    }
  }
  const barberOfMonthCount = thisMonth.filter((a) => a.barber_name === barberOfMonth).length;

  return {
    revenueThisMonth,
    revenueLastMonth,
    revenueGrowthPercent: pctGrowth(revenueThisMonth, revenueLastMonth),
    countRealizedThisMonth,
    countRealizedLastMonth,
    countGrowthPercent: pctGrowth(countRealizedThisMonth, countRealizedLastMonth),
    avgTicketThisMonth,
    avgTicketLastMonth,
    avgTicketGrowthPercent: pctGrowth(avgTicketThisMonth, avgTicketLastMonth),
    barberOfMonth: barberOfMonth
      ? { name: barberOfMonth, revenue: topRevenue / 100, count: barberOfMonthCount }
      : null,
    monthlyGoal: shopGoalCents / 100,
    monthlyGoalPercent: goalProgress(revenueThisMonth, shopGoalCents),
  };
}

export function getBarberOwnSummary(barbershopId, barberId) {
  const now = new Date();
  const barber = getBarbers(barbershopId, { includeInactive: true }).find((b) => b.id === barberId);
  const all = getAppointments({ barbershopId, barberId }).filter((a) => a.status !== "no_show");

  const thisMonthKey = monthKey(localDateStr(now));
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthKey = monthKey(localDateStr(lastMonthDate));

  const thisMonth = all.filter((a) => a.date.slice(0, 7) === thisMonthKey);
  const lastMonth = all.filter((a) => a.date.slice(0, 7) === lastMonthKey);
  const lastMonthMTD = lastMonth.filter((a) => Number(a.date.slice(8, 10)) <= now.getDate());

  const endDateTime = (a) => new Date(`${a.date}T${a.end_time}:00`);
  const realizedThisMonth = thisMonth.filter((a) => endDateTime(a) <= now);

  const revenueThisMonth = sum(thisMonth.map((a) => a.price_cents)) / 100;
  const revenueLastMonth = sum(lastMonthMTD.map((a) => a.price_cents)) / 100;

  const countRealizedThisMonth = realizedThisMonth.length;
  const countRealizedLastMonth = lastMonthMTD.length;

  const revenueRealizedThisMonth = sum(realizedThisMonth.map((a) => a.price_cents)) / 100;

  const avgTicketThisMonth = countRealizedThisMonth
    ? revenueRealizedThisMonth / countRealizedThisMonth
    : 0;

  const commissionPercent = barber?.commission_percent ?? 0;

  return {
    revenueThisMonth,
    revenueGrowthPercent: pctGrowth(revenueThisMonth, revenueLastMonth),
    countRealizedThisMonth,
    countGrowthPercent: pctGrowth(countRealizedThisMonth, countRealizedLastMonth),
    avgTicketThisMonth,
    commissionPercent,
    commissionEarned: (revenueThisMonth * commissionPercent) / 100,
    monthlyGoal: (barber?.monthly_goal_cents ?? 0) / 100,
    monthlyGoalPercent: goalProgress(revenueThisMonth, barber?.monthly_goal_cents ?? 0),
  };
}

export function getRevenueDaily(barbershopId, range) {
  const now = new Date();
  let days;
  if (range === "week") days = 7;
  else if (range === "3months") days = 90;
  else days = 30; // "month"

  const all = getAppointments({ barbershopId }).filter((a) => a.status !== "no_show");
  const byDate = groupSum(all, (a) => a.date, (a) => a.price_cents);
  const productsByDate = groupSum(
    getProductSalesRevenue(barbershopId, {}),
    (p) => p.date,
    (p) => p.amount_cents
  );

  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const ds = localDateStr(d);
    result.push({ date: ds, revenue: Math.round((byDate[ds] || 0) + (productsByDate[ds] || 0)) / 100 });
  }
  return result;
}

export function getBarberPerformance(barbershopId) {
  const now = new Date();
  const barbers = getBarbers(barbershopId);
  const shop = getBarbershop(barbershopId);
  const all = getAppointments({ barbershopId }).filter((a) => a.status !== "no_show");
  const thisMonthKey = monthKey(localDateStr(now));
  const thisMonth = all.filter((a) => a.date.slice(0, 7) === thisMonthKey);

  const openMin = toMinutes(shop.opens_at);
  const closeMin = toMinutes(shop.closes_at);
  const dailyMinutes = closeMin - openMin;

  const year = now.getFullYear();
  const month = now.getMonth();
  let workingDays = 0;
  for (let day = 1; day <= now.getDate(); day++) {
    const d = new Date(year, month, day);
    if (d.getDay() !== 0) workingDays++;
  }
  const availableMinutes = Math.max(dailyMinutes * workingDays, 1);

  return barbers
    .map((b) => {
      const rows = thisMonth.filter((a) => a.barber_id === b.id);
      const revenue = sum(rows.map((a) => a.price_cents)) / 100;
      const count = rows.length;
      const bookedMinutes = sum(rows.map((a) => a.duration_min));
      const occupancyPercent = Math.min(100, Math.round((bookedMinutes / availableMinutes) * 100));
      return {
        id: b.id,
        name: b.name,
        revenue,
        count,
        occupancyPercent,
        monthlyGoal: b.monthly_goal_cents / 100,
        monthlyGoalPercent: goalProgress(revenue, b.monthly_goal_cents),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

export function computeApptStatus(a, now = new Date()) {
  if (a.status === "no_show") return "nao_compareceu";
  const start = new Date(`${a.date}T${a.start_time}:00`);
  const end = new Date(`${a.date}T${a.end_time}:00`);
  if (now >= end) return "concluido";
  if (now >= start) return "em_andamento";
  return "confirmado";
}

export function getTodayAppointments(barbershopId) {
  const now = new Date();
  const todayStr = localDateStr(now);
  const all = getAppointments({ barbershopId, date: todayStr });

  return all
    .map((a) => ({ ...a, computed_status: computeApptStatus(a, now) }))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
}

export function getAppointmentsInRange(barbershopId, barberId, dateFrom, dateTo) {
  const now = new Date();
  const all = getAppointments({ barbershopId, barberId, dateFrom, dateTo });
  return all
    .map((a) => ({ ...a, computed_status: computeApptStatus(a, now) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));
}

function periodDateFrom(period) {
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

export function getHistory(barbershopId, { period, barberId } = {}) {
  const now = new Date();
  const dateFrom = periodDateFrom(period);
  const dateTo = localDateStr(now);
  const all = getAppointments({ barbershopId, barberId, dateFrom });
  const realized = all.filter((a) => computeApptStatus(a, now) === "concluido");

  const revenueByBarber = groupSum(realized, (a) => a.barber_name, (a) => a.price_cents);
  const revenueByService = groupSum(realized, (a) => a.service_name, (a) => a.price_cents);

  // Product sales and expenses aren't tied to a specific barber, so they only factor
  // into the shop-wide totals (not shown when filtering the history by one barber).
  const productRevenue = barberId
    ? 0
    : sum(getProductSalesRevenue(barbershopId, { dateFrom, dateTo }).map((p) => p.amount_cents)) / 100;
  const totalExpenses = barberId ? 0 : getTotalExpenses(barbershopId, { dateFrom, dateTo }) / 100;

  const serviceRevenue = sum(realized.map((a) => a.price_cents)) / 100;
  const totalRevenue = serviceRevenue + productRevenue;

  return {
    totalRevenue,
    totalCount: realized.length,
    productRevenue,
    totalExpenses,
    netProfit: totalRevenue - totalExpenses,
    byBarber: Object.entries(revenueByBarber).map(([name, revenue]) => ({ name, revenue: revenue / 100 })),
    byService: Object.entries(revenueByService).map(([name, revenue]) => ({ name, revenue: revenue / 100 })),
  };
}
