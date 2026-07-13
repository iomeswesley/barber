import express from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getBarbershops,
  getBarbershop,
  updateBarbershopHours,
  getServices,
  getBarbers,
  getAppointments,
  getAppointmentById,
  updateAppointmentDetails,
  getAffectedAppointments,
  getUserByUsername,
  getBarber,
  createBarber,
  updateBarber,
  setBarberActive,
  getService,
  createService,
  updateService,
  setServiceActive,
  createTimeBlock,
  listTimeBlocks,
  listTimeBlocksForBarber,
  getTimeBlockById,
  updateTimeBlock,
  deleteTimeBlock,
  listReviews,
  getReviewStats,
  getClientStats,
  getClientById,
  clientBelongsToShop,
  updateClientBirthday,
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  setProductActive,
  getProductSalesForAppointment,
  replaceAppointmentProductSales,
  listExpenses,
  createExpense,
  getExpenseById,
  deleteExpense,
  logAudit,
  listAuditLog,
} from "./db.js";
import { verifyPassword, requireAuth, requireOwner } from "./auth.js";
import { sendMessage, resetSession } from "./chatEngine.js";
import { generateIcs } from "./ics.js";
import {
  getDashboardSummary,
  getRevenueDaily,
  getBarberPerformance,
  getTodayAppointments,
  getBarberOwnSummary,
  getAppointmentsInRange,
  getHistory,
} from "./dashboardStats.js";
import {
  startReminderScheduler,
  sendWhatsAppMessage,
  buildComeBackText,
  buildRescheduleNoticeText,
} from "./reminders.js";
import { chatRateLimiter, loginRateLimiter } from "./rateLimiter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// A last-minute (non-recurring) time block can collide with appointments already booked
// for that date — this notifies each affected client so the shop doesn't just silently
// no-show them. Recurring blocks have no single date to check against, so they're skipped.
function notifyAffectedAppointments(barbershopId, { barberId, date, startTime, endTime, recurring }) {
  if (recurring) return;
  const affected = getAffectedAppointments(barbershopId, barberId, date, startTime, endTime);
  for (const appointment of affected) {
    sendWhatsAppMessage(appointment.client_phone, buildRescheduleNoticeText(appointment));
  }
  return affected;
}

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-troque-em-producao",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8h
  })
);

/* ---------------- Protected page routes (before the static file server) ---------------- */

app.get("/admin.html", (req, res, next) => {
  if (req.session?.user?.role === "owner") return next();
  return res.redirect("/login.html");
});

app.get("/barber.html", (req, res, next) => {
  if (req.session?.user?.role === "barber") return next();
  return res.redirect("/login.html");
});

app.use(express.static(path.join(__dirname, "..", "public")));

/* ---------------- Auth ---------------- */

app.post("/api/auth/login", loginRateLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "username e password são obrigatórios" });
  }
  const user = getUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Usuário ou senha inválidos" });
  }
  req.session.user = {
    id: user.id,
    role: user.role,
    barbershopId: user.barbershop_id,
    barberId: user.barber_id,
    name: user.name,
  };
  res.json({ ok: true, redirect: user.role === "owner" ? "/admin.html" : "/barber.html" });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  const shop = getBarbershop(req.session.user.barbershopId);
  res.json({ ...req.session.user, barbershopName: shop?.name || null });
});

/* ---------------- Public booking-facing routes ---------------- */

app.get("/api/barbershops", (req, res) => {
  res.json(getBarbershops());
});

app.get("/api/barbershops/:id/services", (req, res) => {
  res.json(getServices(Number(req.params.id)));
});

app.get("/api/barbershops/:id/barbers", (req, res) => {
  res.json(getBarbers(Number(req.params.id)));
});

app.post("/api/chat", chatRateLimiter, async (req, res) => {
  const { barbershopId, sessionId, message, customerPhone, pushName } = req.body || {};
  if (!barbershopId || !sessionId || !message || !customerPhone) {
    return res
      .status(400)
      .json({ error: "barbershopId, sessionId, message e customerPhone são obrigatórios" });
  }
  const shop = getBarbershop(Number(barbershopId));
  if (!shop) return res.status(404).json({ error: "Barbearia não encontrada" });

  // Em uma integração real de WhatsApp, o telefone chega já normalizado (wa_id).
  // Aqui normalizamos o que o simulador envia para manter a identificação do cliente consistente.
  const normalizedPhone = String(customerPhone).replace(/\D/g, "");
  if (!normalizedPhone) {
    return res.status(400).json({ error: "customerPhone inválido" });
  }

  try {
    const reply = await sendMessage(Number(barbershopId), sessionId, message, normalizedPhone, pushName);
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao processar a mensagem", detail: err.message });
  }
});

app.post("/api/chat/reset", (req, res) => {
  const { sessionId } = req.body || {};
  if (sessionId) resetSession(sessionId);
  res.json({ ok: true });
});

app.get("/api/appointments/:id/ics", (req, res) => {
  const appointment = getAppointmentById(Number(req.params.id));
  if (!appointment) return res.status(404).send("Agendamento não encontrado");

  const ics = generateIcs(appointment);
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="agendamento-${appointment.id}.ics"`
  );
  res.send(ics);
});

/* ---------------- Owner dashboard (protected) ---------------- */

app.get("/api/dashboard/summary", requireAuth, requireOwner, (req, res) => {
  res.json(getDashboardSummary(req.session.user.barbershopId));
});

app.get("/api/dashboard/revenue", requireAuth, requireOwner, (req, res) => {
  const range = ["week", "month", "3months"].includes(req.query.range) ? req.query.range : "month";
  res.json(getRevenueDaily(req.session.user.barbershopId, range));
});

app.get("/api/dashboard/barbers", requireAuth, requireOwner, (req, res) => {
  res.json(getBarberPerformance(req.session.user.barbershopId));
});

app.get("/api/dashboard/today", requireAuth, requireOwner, (req, res) => {
  res.json(getTodayAppointments(req.session.user.barbershopId));
});

app.get("/api/dashboard/reviews", requireAuth, requireOwner, (req, res) => {
  const barbershopId = req.session.user.barbershopId;
  const { period, barberId } = req.query;
  const filters = { period: period || undefined, barberId: barberId ? Number(barberId) : undefined };
  res.json({ stats: getReviewStats(barbershopId, filters), recent: listReviews(barbershopId, 20, filters) });
});

app.get("/api/appointments", requireAuth, requireOwner, (req, res) => {
  const { barberId, date } = req.query;
  const appointments = getAppointments({
    barbershopId: req.session.user.barbershopId,
    barberId: barberId ? Number(barberId) : undefined,
    date: date || undefined,
  });
  res.json(appointments);
});

app.get("/api/dashboard/calendar", requireAuth, requireOwner, (req, res) => {
  const { start, end, barberId } = req.query;
  if (!start || !end) return res.status(400).json({ error: "start e end são obrigatórios" });
  res.json(
    getAppointmentsInRange(
      req.session.user.barbershopId,
      barberId ? Number(barberId) : undefined,
      start,
      end
    )
  );
});

app.get("/api/dashboard/history", requireAuth, requireOwner, (req, res) => {
  const { period, barberId } = req.query;
  res.json(
    getHistory(req.session.user.barbershopId, {
      period: period || undefined,
      barberId: barberId ? Number(barberId) : undefined,
    })
  );
});

app.get("/api/dashboard/clients", requireAuth, requireOwner, (req, res) => {
  res.json(getClientStats(req.session.user.barbershopId));
});

app.put("/api/manage/clients/:id/birthday", requireAuth, requireOwner, (req, res) => {
  const clientId = Number(req.params.id);
  if (!clientBelongsToShop(clientId, req.session.user.barbershopId)) {
    return res.status(404).json({ error: "Cliente não encontrado" });
  }
  const { birthday } = req.body || {};
  res.json(updateClientBirthday(clientId, birthday || null));
});

app.post("/api/manage/clients/:id/nudge", requireAuth, requireOwner, (req, res) => {
  const clientId = Number(req.params.id);
  if (!clientBelongsToShop(clientId, req.session.user.barbershopId)) {
    return res.status(404).json({ error: "Cliente não encontrado" });
  }
  const client = getClientById(clientId);
  const shop = getBarbershop(req.session.user.barbershopId);
  sendWhatsAppMessage(client.phone, buildComeBackText(client.name, shop?.name || "nossa barbearia"));
  res.json({ ok: true });
});

app.get("/api/appointments/:id/product-sales", requireAuth, (req, res) => {
  const appointment = getAppointmentById(Number(req.params.id));
  if (!appointment || appointment.barbershop_id !== req.session.user.barbershopId) {
    return res.status(404).json({ error: "Agendamento não encontrado" });
  }
  if (req.session.user.role === "barber" && appointment.barber_id !== req.session.user.barberId) {
    return res.status(403).json({ error: "Você só pode ver seus próprios agendamentos" });
  }
  res.json(getProductSalesForAppointment(appointment.id));
});

app.put("/api/appointments/:id", requireAuth, (req, res) => {
  const appointment = getAppointmentById(Number(req.params.id));
  if (!appointment || appointment.barbershop_id !== req.session.user.barbershopId) {
    return res.status(404).json({ error: "Agendamento não encontrado" });
  }
  if (req.session.user.role === "barber" && appointment.barber_id !== req.session.user.barberId) {
    return res.status(403).json({ error: "Você só pode editar seus próprios agendamentos" });
  }
  const { clientName, serviceId, status, productSales } = req.body || {};
  if (status && !["confirmed", "no_show"].includes(status)) {
    return res.status(400).json({ error: "status inválido" });
  }
  const sales = Array.isArray(productSales) ? productSales : [];
  for (const s of sales) {
    if (!s.productId) continue;
    const product = getProduct(Number(s.productId));
    if (!product || product.barbershop_id !== req.session.user.barbershopId) {
      return res.status(400).json({ error: "Produto inválido" });
    }
  }
  try {
    const updated = updateAppointmentDetails(Number(req.params.id), { clientName, serviceId, status });
    const soldProducts = replaceAppointmentProductSales(
      req.session.user.barbershopId,
      updated.client_id,
      updated.id,
      updated.date,
      sales.map((s) => ({ productId: Number(s.productId), quantity: Number(s.quantity) || 1 }))
    );
    const productsSummary = soldProducts.map((s) => `${s.quantity}x ${s.product_name}`).join(", ");
    logAudit(
      req.session.user.barbershopId,
      req.session.user.name,
      "Editou agendamento",
      `#${updated.id} — ${updated.client_name} (${updated.service_name})${status ? ` · status: ${status}` : ""}${productsSummary ? ` · produtos: ${productsSummary}` : ""}`
    );
    res.json({ ...updated, productSales: soldProducts });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/manage/business-hours", requireAuth, requireOwner, (req, res) => {
  const { opensAt, closesAt } = req.body || {};
  if (!opensAt || !closesAt) return res.status(400).json({ error: "opensAt e closesAt são obrigatórios" });
  const shop = updateBarbershopHours(req.session.user.barbershopId, opensAt, closesAt);
  logAudit(req.session.user.barbershopId, req.session.user.name, "Alterou horário de funcionamento", `${opensAt}–${closesAt}`);
  res.json(shop);
});

/* ---------------- Produtos e vendas de balcão (owner only) ---------------- */

app.get("/api/manage/products", requireAuth, (req, res) => {
  res.json(getProducts(req.session.user.barbershopId, { includeInactive: true }));
});

app.post("/api/manage/products", requireAuth, requireOwner, (req, res) => {
  const { name, priceCents } = req.body || {};
  if (!name || !name.trim() || !priceCents) {
    return res.status(400).json({ error: "name e priceCents são obrigatórios" });
  }
  const product = createProduct(req.session.user.barbershopId, { name: name.trim(), priceCents: Number(priceCents) });
  logAudit(req.session.user.barbershopId, req.session.user.name, "Criou produto", product.name);
  res.status(201).json(product);
});

app.put("/api/manage/products/:id", requireAuth, requireOwner, (req, res) => {
  const product = getProduct(Number(req.params.id));
  if (!product || product.barbershop_id !== req.session.user.barbershopId) {
    return res.status(404).json({ error: "Produto não encontrado" });
  }
  const { name, priceCents } = req.body || {};
  if (!name || !name.trim() || !priceCents) {
    return res.status(400).json({ error: "name e priceCents são obrigatórios" });
  }
  const updated = updateProduct(Number(req.params.id), { name: name.trim(), priceCents: Number(priceCents) });
  logAudit(req.session.user.barbershopId, req.session.user.name, "Editou produto", updated.name);
  res.json(updated);
});

app.post("/api/manage/products/:id/active", requireAuth, requireOwner, (req, res) => {
  const product = getProduct(Number(req.params.id));
  if (!product || product.barbershop_id !== req.session.user.barbershopId) {
    return res.status(404).json({ error: "Produto não encontrado" });
  }
  const { active } = req.body || {};
  res.json(setProductActive(Number(req.params.id), !!active));
});

/* ---------------- Despesas (owner only) ---------------- */

app.get("/api/manage/expenses", requireAuth, requireOwner, (req, res) => {
  res.json(listExpenses(req.session.user.barbershopId));
});

app.post("/api/manage/expenses", requireAuth, requireOwner, (req, res) => {
  const { description, amountCents, startDate, recurring } = req.body || {};
  if (!description || !description.trim() || !amountCents || !startDate) {
    return res.status(400).json({ error: "description, amountCents e startDate são obrigatórios" });
  }
  const expense = createExpense(req.session.user.barbershopId, {
    description: description.trim(),
    amountCents: Number(amountCents),
    startDate,
    recurring: !!recurring,
  });
  logAudit(
    req.session.user.barbershopId,
    req.session.user.name,
    "Registrou despesa",
    `${expense.description} — R$ ${(expense.amount_cents / 100).toFixed(2)}${expense.recurring ? " (mensal)" : ""}`
  );
  res.status(201).json(expense);
});

app.delete("/api/manage/expenses/:id", requireAuth, requireOwner, (req, res) => {
  const expense = getExpenseById(Number(req.params.id));
  if (!expense || expense.barbershop_id !== req.session.user.barbershopId) {
    return res.status(404).json({ error: "Despesa não encontrada" });
  }
  deleteExpense(Number(req.params.id));
  logAudit(req.session.user.barbershopId, req.session.user.name, "Removeu despesa", expense.description);
  res.json({ ok: true });
});

/* ---------------- Log de auditoria (owner only) ---------------- */

app.get("/api/manage/audit-log", requireAuth, requireOwner, (req, res) => {
  res.json(listAuditLog(req.session.user.barbershopId));
});

/* ---------------- Barber's own dashboard (protected) ---------------- */

app.get("/api/dashboard/my-today", requireAuth, (req, res) => {
  if (req.session.user.role !== "barber") return res.status(403).json({ error: "Somente barbeiros" });
  const all = getTodayAppointments(req.session.user.barbershopId);
  res.json(all.filter((a) => a.barber_id === req.session.user.barberId));
});

app.get("/api/dashboard/my-summary", requireAuth, (req, res) => {
  if (req.session.user.role !== "barber") return res.status(403).json({ error: "Somente barbeiros" });
  res.json(getBarberOwnSummary(req.session.user.barbershopId, req.session.user.barberId));
});

app.get("/api/dashboard/my-calendar", requireAuth, (req, res) => {
  if (req.session.user.role !== "barber") return res.status(403).json({ error: "Somente barbeiros" });
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: "start e end são obrigatórios" });
  res.json(
    getAppointmentsInRange(req.session.user.barbershopId, req.session.user.barberId, start, end)
  );
});

/* ---------------- Barber's own time blocks (protected) ---------------- */

app.get("/api/barber/time-blocks", requireAuth, (req, res) => {
  if (req.session.user.role !== "barber") return res.status(403).json({ error: "Somente barbeiros" });
  res.json(listTimeBlocksForBarber(req.session.user.barbershopId, req.session.user.barberId));
});

app.post("/api/barber/time-blocks", requireAuth, (req, res) => {
  if (req.session.user.role !== "barber") return res.status(403).json({ error: "Somente barbeiros" });
  const { type, label, date, startTime, endTime, recurring } = req.body || {};
  if (!type || !startTime || !endTime || (!recurring && !date)) {
    return res
      .status(400)
      .json({ error: "type, startTime, endTime são obrigatórios (e date, se não for recorrente)" });
  }
  const block = createTimeBlock(req.session.user.barbershopId, {
    barberId: req.session.user.barberId,
    type,
    label,
    date,
    startTime,
    endTime,
    recurring: !!recurring,
  });
  const affected = notifyAffectedAppointments(req.session.user.barbershopId, {
    barberId: req.session.user.barberId,
    date,
    startTime,
    endTime,
    recurring: !!recurring,
  });
  logAudit(
    req.session.user.barbershopId,
    req.session.user.name,
    "Criou bloqueio de horário (próprio)",
    `${date || "recorrente"} ${startTime}–${endTime}${affected?.length ? ` · ${affected.length} cliente(s) avisado(s)` : ""}`
  );
  res.status(201).json({ ...block, affectedCount: affected?.length || 0 });
});

app.delete("/api/barber/time-blocks/:id", requireAuth, (req, res) => {
  if (req.session.user.role !== "barber") return res.status(403).json({ error: "Somente barbeiros" });
  const block = getTimeBlockById(Number(req.params.id));
  if (!block || block.barbershop_id !== req.session.user.barbershopId || block.barber_id !== req.session.user.barberId) {
    return res.status(404).json({ error: "Bloqueio não encontrado" });
  }
  deleteTimeBlock(Number(req.params.id));
  res.json({ ok: true });
});

/* ---------------- Barber & service management (owner only) ---------------- */

app.get("/api/manage/barbers", requireAuth, requireOwner, (req, res) => {
  res.json(getBarbers(req.session.user.barbershopId, { includeInactive: true }));
});

app.post("/api/manage/barbers", requireAuth, requireOwner, (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Nome é obrigatório" });
  const barber = createBarber(req.session.user.barbershopId, name.trim());
  logAudit(req.session.user.barbershopId, req.session.user.name, "Criou barbeiro", barber.name);
  res.status(201).json(barber);
});

app.put("/api/manage/barbers/:id", requireAuth, requireOwner, (req, res) => {
  const barber = getBarber(Number(req.params.id));
  if (!barber || barber.barbershop_id !== req.session.user.barbershopId) {
    return res.status(404).json({ error: "Barbeiro não encontrado" });
  }
  const { name, commissionPercent, monthlyGoalCents } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Nome é obrigatório" });
  const updated = updateBarber(Number(req.params.id), name.trim(), {
    commissionPercent: commissionPercent !== undefined ? Number(commissionPercent) : undefined,
    monthlyGoalCents: monthlyGoalCents !== undefined ? Number(monthlyGoalCents) : undefined,
  });
  logAudit(
    req.session.user.barbershopId,
    req.session.user.name,
    "Editou barbeiro",
    `${updated.name} · comissão ${updated.commission_percent}% · meta R$ ${(updated.monthly_goal_cents / 100).toFixed(2)}`
  );
  res.json(updated);
});

app.post("/api/manage/barbers/:id/active", requireAuth, requireOwner, (req, res) => {
  const barber = getBarber(Number(req.params.id));
  if (!barber || barber.barbershop_id !== req.session.user.barbershopId) {
    return res.status(404).json({ error: "Barbeiro não encontrado" });
  }
  const { active } = req.body || {};
  const updated = setBarberActive(Number(req.params.id), !!active);
  logAudit(req.session.user.barbershopId, req.session.user.name, active ? "Ativou barbeiro" : "Desativou barbeiro", updated.name);
  res.json(updated);
});

app.get("/api/manage/services", requireAuth, requireOwner, (req, res) => {
  res.json(getServices(req.session.user.barbershopId, { includeInactive: true }));
});

app.post("/api/manage/services", requireAuth, requireOwner, (req, res) => {
  const { name, priceCents, durationMin } = req.body || {};
  if (!name || !name.trim() || !priceCents || !durationMin) {
    return res.status(400).json({ error: "name, priceCents e durationMin são obrigatórios" });
  }
  const service = createService(req.session.user.barbershopId, {
    name: name.trim(),
    priceCents: Number(priceCents),
    durationMin: Number(durationMin),
  });
  logAudit(req.session.user.barbershopId, req.session.user.name, "Criou serviço", service.name);
  res.status(201).json(service);
});

app.put("/api/manage/services/:id", requireAuth, requireOwner, (req, res) => {
  const service = getService(Number(req.params.id));
  if (!service || service.barbershop_id !== req.session.user.barbershopId) {
    return res.status(404).json({ error: "Serviço não encontrado" });
  }
  const { name, priceCents, durationMin } = req.body || {};
  if (!name || !name.trim() || !priceCents || !durationMin) {
    return res.status(400).json({ error: "name, priceCents e durationMin são obrigatórios" });
  }
  const updated = updateService(Number(req.params.id), {
    name: name.trim(),
    priceCents: Number(priceCents),
    durationMin: Number(durationMin),
  });
  logAudit(req.session.user.barbershopId, req.session.user.name, "Editou serviço", updated.name);
  res.json(updated);
});

app.post("/api/manage/services/:id/active", requireAuth, requireOwner, (req, res) => {
  const service = getService(Number(req.params.id));
  if (!service || service.barbershop_id !== req.session.user.barbershopId) {
    return res.status(404).json({ error: "Serviço não encontrado" });
  }
  const { active } = req.body || {};
  res.json(setServiceActive(Number(req.params.id), !!active));
});

/* ---------------- Time blocks (owner only) ---------------- */

app.get("/api/manage/time-blocks", requireAuth, requireOwner, (req, res) => {
  res.json(listTimeBlocks(req.session.user.barbershopId));
});

app.post("/api/manage/time-blocks", requireAuth, requireOwner, (req, res) => {
  const { barberId, type, label, date, startTime, endTime, recurring } = req.body || {};
  if (!type || !startTime || !endTime || (!recurring && !date)) {
    return res
      .status(400)
      .json({ error: "type, startTime, endTime são obrigatórios (e date, se não for recorrente)" });
  }
  if (barberId) {
    const barber = getBarber(Number(barberId));
    if (!barber || barber.barbershop_id !== req.session.user.barbershopId) {
      return res.status(400).json({ error: "Barbeiro inválido" });
    }
  }
  const block = createTimeBlock(req.session.user.barbershopId, {
    barberId: barberId ? Number(barberId) : null,
    type,
    label,
    date,
    startTime,
    endTime,
    recurring: !!recurring,
  });
  const affected = notifyAffectedAppointments(req.session.user.barbershopId, {
    barberId: barberId ? Number(barberId) : null,
    date,
    startTime,
    endTime,
    recurring: !!recurring,
  });
  logAudit(
    req.session.user.barbershopId,
    req.session.user.name,
    "Criou bloqueio de horário",
    `${date || "recorrente"} ${startTime}–${endTime}${affected?.length ? ` · ${affected.length} cliente(s) avisado(s)` : ""}`
  );
  res.status(201).json({ ...block, affectedCount: affected?.length || 0 });
});

app.put("/api/manage/time-blocks/:id", requireAuth, requireOwner, (req, res) => {
  const block = getTimeBlockById(Number(req.params.id));
  if (!block || block.barbershop_id !== req.session.user.barbershopId) {
    return res.status(404).json({ error: "Bloqueio não encontrado" });
  }
  const { barberId, type, label, date, startTime, endTime, recurring } = req.body || {};
  if (!type || !startTime || !endTime || (!recurring && !date)) {
    return res
      .status(400)
      .json({ error: "type, startTime, endTime são obrigatórios (e date, se não for recorrente)" });
  }
  if (barberId) {
    const barber = getBarber(Number(barberId));
    if (!barber || barber.barbershop_id !== req.session.user.barbershopId) {
      return res.status(400).json({ error: "Barbeiro inválido" });
    }
  }
  res.json(
    updateTimeBlock(Number(req.params.id), {
      barberId: barberId ? Number(barberId) : null,
      type,
      label,
      date,
      startTime,
      endTime,
      recurring: !!recurring,
    })
  );
});

app.delete("/api/manage/time-blocks/:id", requireAuth, requireOwner, (req, res) => {
  const block = getTimeBlockById(Number(req.params.id));
  if (!block || block.barbershop_id !== req.session.user.barbershopId) {
    return res.status(404).json({ error: "Bloqueio não encontrado" });
  }
  deleteTimeBlock(Number(req.params.id));
  logAudit(req.session.user.barbershopId, req.session.user.name, "Removeu bloqueio de horário", `#${block.id}`);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Barbearia Bot rodando em http://localhost:${PORT}`);
  startReminderScheduler();
});
