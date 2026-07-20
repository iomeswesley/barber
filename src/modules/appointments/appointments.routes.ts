import { Router } from "express";
import { requireAuth, requireOwner, belongsToSession } from "@/middleware/auth.js";
import { selfServiceRateLimiter } from "@/middleware/rateLimiter.js";
import { AppError } from "@/middleware/errorHandler.js";
import { normalizePhone } from "@/lib/time.js";
import { generateIcs } from "@/lib/ics.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { getClientByPhone, findOrCreateClient } from "@/modules/clients/clients.repository.js";
import { getProduct, getProductSalesForAppointment, replaceAppointmentProductSales } from "@/modules/products/products.repository.js";
import { toApiAppointment, toApiProductSale } from "@/lib/apiMappers.js";
import { getAppointments, getAppointmentById as getAppointmentByIdRaw } from "./appointments.repository.js";
import {
  getAvailableSlots,
  createAppointment,
  cancelAppointment,
  rescheduleAppointment,
  updateAppointmentDetails,
  getAppointmentsByClientPhone,
  getClientAppointmentHistory,
} from "./appointments.service.js";

export const appointmentsRouter = Router();

/* ---------------- Autoatendimento público (sem passar pelo chat) ---------------- */
// Modelo de confiança igual ao do chat: o telefone do cliente é a única checagem de
// identidade, igual a como o WhatsApp já os identifica hoje. Rate-limited por telefone.

appointmentsRouter.get("/api/public/appointments", selfServiceRateLimiter, async (req, res, next) => {
  try {
    const { barbershopId, phone } = req.query;
    const normalizedPhone = normalizePhone(phone);
    if (!barbershopId || !normalizedPhone) throw new AppError("barbershopId e phone são obrigatórios");
    const appointments = await getAppointmentsByClientPhone(normalizedPhone, Number(barbershopId), { upcomingOnly: true });
    res.json(appointments.map(toApiAppointment));
  } catch (err) {
    next(err);
  }
});

appointmentsRouter.get("/api/public/appointment-history", selfServiceRateLimiter, async (req, res, next) => {
  try {
    const { barbershopId, phone } = req.query;
    const normalizedPhone = normalizePhone(phone);
    if (!barbershopId || !normalizedPhone) throw new AppError("barbershopId e phone são obrigatórios");
    const appointments = await getClientAppointmentHistory(normalizedPhone, Number(barbershopId));
    res.json(appointments.map(toApiAppointment));
  } catch (err) {
    next(err);
  }
});

// Cria um agendamento novo reaproveitando uma combinação serviço/barbeiro do
// histórico do próprio cliente ("reagendar igual ao último") — distinto de
// /reschedule, que move um agendamento existente em vez de criar um novo.
appointmentsRouter.post("/api/public/appointments", selfServiceRateLimiter, async (req, res, next) => {
  try {
    const { barbershopId, phone, barberId, serviceId, date, startTime } = req.body || {};
    const normalizedPhone = normalizePhone(phone);
    if (!barbershopId || !normalizedPhone || !barberId || !serviceId || !date || !startTime) {
      throw new AppError("barbershopId, phone, barberId, serviceId, date e startTime são obrigatórios");
    }
    const client = await getClientByPhone(normalizedPhone);
    if (!client) throw new AppError("Cliente não encontrado", 404);
    const appointment = await createAppointment({
      barbershopId: Number(barbershopId),
      barberId: Number(barberId),
      serviceId: Number(serviceId),
      clientId: client.id,
      date,
      startTime,
    });
    res.status(201).json(toApiAppointment(appointment));
  } catch (err) {
    next(err);
  }
});

appointmentsRouter.get("/api/public/available-slots", selfServiceRateLimiter, async (req, res, next) => {
  try {
    const { barbershopId, barberId, serviceId, date } = req.query;
    if (!barbershopId || !barberId || !serviceId || !date) {
      throw new AppError("barbershopId, barberId, serviceId e date são obrigatórios");
    }
    res.json(await getAvailableSlots(Number(barbershopId), Number(barberId), Number(serviceId), String(date)));
  } catch (err) {
    next(err);
  }
});

appointmentsRouter.post("/api/public/appointments/:id/cancel", selfServiceRateLimiter, async (req, res, next) => {
  try {
    const appointment = await getAppointmentByIdRaw(Number(req.params.id));
    const normalizedPhone = normalizePhone(req.body?.phone);
    if (!appointment || appointment.clientPhone !== normalizedPhone) {
      throw new AppError("Agendamento não encontrado", 404);
    }
    res.json(toApiAppointment(await cancelAppointment(appointment.id)));
  } catch (err) {
    next(err);
  }
});

appointmentsRouter.post("/api/public/appointments/:id/reschedule", selfServiceRateLimiter, async (req, res, next) => {
  try {
    const appointment = await getAppointmentByIdRaw(Number(req.params.id));
    const normalizedPhone = normalizePhone(req.body?.phone);
    if (!appointment || appointment.clientPhone !== normalizedPhone) {
      throw new AppError("Agendamento não encontrado", 404);
    }
    const { newDate, newStartTime } = req.body || {};
    if (!newDate || !newStartTime) throw new AppError("newDate e newStartTime são obrigatórios");
    res.json(toApiAppointment(await rescheduleAppointment(appointment.id, newDate, newStartTime)));
  } catch (err) {
    next(err);
  }
});

appointmentsRouter.get("/api/appointments/:id/ics", selfServiceRateLimiter, async (req, res) => {
  const appointment = await getAppointmentByIdRaw(Number(req.params.id));
  const normalizedPhone = normalizePhone(req.query?.phone);
  if (!appointment || !normalizedPhone || appointment.clientPhone !== normalizedPhone) {
    return res.status(404).send("Agendamento não encontrado");
  }

  const ics = generateIcs(appointment);
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="agendamento-${appointment.id}.ics"`);
  res.send(ics);
});

/* ---------------- Painel do dono (protegido) ---------------- */

appointmentsRouter.get("/api/appointments", requireAuth, requireOwner, async (req, res) => {
  const { barberId, date } = req.query;
  const appointments = await getAppointments({
    barbershopId: req.session.user!.barbershopId,
    barberId: barberId ? Number(barberId) : undefined,
    date: date ? String(date) : undefined,
  });
  res.json(appointments.map(toApiAppointment));
});

// Agendamento manual criado pelo painel (dono ou barbeiro), diferente do
// autoatendimento público — aqui quem cria já está autenticado, então o
// cliente é buscado/criado por telefone (findOrCreateClient) em vez de
// exigir que já exista, como faz POST /api/public/appointments.
appointmentsRouter.post("/api/appointments", requireAuth, async (req, res, next) => {
  try {
    const { clientName, clientPhone, barberId, serviceId, date, startTime } = req.body || {};
    const normalizedPhone = normalizePhone(clientPhone);
    if (!clientName || !String(clientName).trim() || !normalizedPhone || !serviceId || !date || !startTime) {
      throw new AppError("Nome do cliente, telefone, serviço, data e horário são obrigatórios");
    }

    // Barbeiro só cria agendamento pra si mesmo — barberId do corpo é
    // ignorado nesse caso (evita marcar em nome de outro barbeiro).
    let targetBarberId = req.session.user!.role === "barber" ? req.session.user!.barberId! : Number(barberId);
    if (!targetBarberId) throw new AppError("Barbeiro é obrigatório");

    const client = await findOrCreateClient(String(clientName).trim(), normalizedPhone);
    const appointment = await createAppointment({
      barbershopId: req.session.user!.barbershopId,
      barberId: targetBarberId,
      serviceId: Number(serviceId),
      clientId: client.id,
      date,
      startTime,
    });
    await logAudit(
      req.session.user!.barbershopId,
      req.session.user!.name,
      "Criou agendamento manual",
      `#${appointment.id} — ${appointment.clientName} (${appointment.serviceName})`
    );
    res.status(201).json(toApiAppointment(appointment));
  } catch (err) {
    next(err);
  }
});

appointmentsRouter.get("/api/appointments/:id/product-sales", requireAuth, async (req, res, next) => {
  try {
    const appointment = await getAppointmentByIdRaw(Number(req.params.id));
    if (!belongsToSession(req, appointment)) throw new AppError("Agendamento não encontrado", 404);
    if (req.session.user!.role === "barber" && appointment!.barberId !== req.session.user!.barberId) {
      throw new AppError("Você só pode ver seus próprios agendamentos", 403);
    }
    const sales = await getProductSalesForAppointment(appointment!.id);
    res.json(sales.map(toApiProductSale));
  } catch (err) {
    next(err);
  }
});

appointmentsRouter.put("/api/appointments/:id", requireAuth, async (req, res, next) => {
  try {
    const appointment = await getAppointmentByIdRaw(Number(req.params.id));
    if (!belongsToSession(req, appointment)) throw new AppError("Agendamento não encontrado", 404);
    if (req.session.user!.role === "barber" && appointment!.barberId !== req.session.user!.barberId) {
      throw new AppError("Você só pode editar seus próprios agendamentos", 403);
    }
    const { clientName, serviceId, status, productSales } = req.body || {};
    if (status && !["confirmed", "no_show"].includes(status)) throw new AppError("status inválido");

    const sales = Array.isArray(productSales) ? productSales : [];
    for (const s of sales) {
      if (!s.productId) continue;
      const product = await getProduct(Number(s.productId));
      if (!belongsToSession(req, product)) throw new AppError("Produto inválido");
    }

    const updated = await updateAppointmentDetails(Number(req.params.id), { clientName, serviceId, status });
    const soldProducts = await replaceAppointmentProductSales(
      req.session.user!.barbershopId,
      updated.clientId,
      updated.id,
      updated.date,
      sales.map((s: any) => ({ productId: Number(s.productId), quantity: Number(s.quantity) || 1 }))
    );
    const productsSummary = soldProducts.map((s) => `${s.quantity}x ${s.productName}`).join(", ");
    await logAudit(
      req.session.user!.barbershopId,
      req.session.user!.name,
      "Editou agendamento",
      `#${updated.id} — ${updated.clientName} (${updated.serviceName})${status ? ` · status: ${status}` : ""}${productsSummary ? ` · produtos: ${productsSummary}` : ""}`
    );
    res.json({ ...toApiAppointment(updated), productSales: soldProducts.map(toApiProductSale) });
  } catch (err) {
    next(err);
  }
});

appointmentsRouter.delete("/api/appointments/:id", requireAuth, async (req, res, next) => {
  try {
    const appointment = await getAppointmentByIdRaw(Number(req.params.id));
    if (!belongsToSession(req, appointment)) throw new AppError("Agendamento não encontrado", 404);
    if (req.session.user!.role === "barber" && appointment!.barberId !== req.session.user!.barberId) {
      throw new AppError("Você só pode excluir seus próprios agendamentos", 403);
    }
    await cancelAppointment(appointment!.id);
    await logAudit(
      req.session.user!.barbershopId,
      req.session.user!.name,
      "Excluiu agendamento",
      `#${appointment!.id} — ${appointment!.clientName} (${appointment!.serviceName})`
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
