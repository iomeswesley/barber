import { Router } from "express";
import { requireAuth, requireOwner, belongsToSession } from "@/middleware/auth.js";
import { selfServiceRateLimiter } from "@/middleware/rateLimiter.js";
import { AppError } from "@/middleware/errorHandler.js";
import { normalizePhone } from "@/lib/time.js";
import { generateIcs } from "@/lib/ics.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { getClientByPhone, findOrCreateClient } from "@/modules/clients/clients.repository.js";
import { assertPhoneVerifiedRecently } from "@/modules/clients/phoneVerification.service.js";
import { getProduct, getProductSalesForAppointment, replaceAppointmentProductSales } from "@/modules/products/products.repository.js";
import { toApiAppointment, toApiProductSale } from "@/lib/apiMappers.js";
import { vertical } from "@/config/env.js";
import { getAppointments, getAppointmentById as getAppointmentByIdRaw } from "./appointments.repository.js";
import {
  getAvailableSlots,
  createAppointment,
  cancelAppointment,
  rescheduleAppointment,
  updateAppointmentDetails,
  getAppointmentsByClientPhone,
  getClientAppointmentHistory,
  confirmAppointmentByToken,
} from "./appointments.service.js";

export const appointmentsRouter = Router();

/* ---------------- Autoatendimento público (sem passar pelo chat) ---------------- */
// Modelo de confiança: criar agendamento novo e ver horários livres continuam
// só com o telefone digitado (não revelam nem alteram dado de terceiro — na
// pior das hipóteses alguém agenda um horário em nome de outro número, que o
// próprio dono vê e pode cancelar). Ver histórico, cancelar, reagendar e
// baixar o .ics exigem o telefone ter passado pelo código OTP do WhatsApp
// há no máximo 15 min (assertPhoneVerifiedRecently, mesmo mecanismo dos
// Planos de Assinatura — ver [[project_saas_rewrite]]) — sem isso, bastava
// saber o telefone de alguém pra ver o histórico dela ou cancelar/reagendar
// um compromisso que não é seu. Rate-limited por telefone em todas.

appointmentsRouter.get("/api/public/appointments", selfServiceRateLimiter, async (req, res, next) => {
  try {
    const { businessId, phone } = req.query;
    const normalizedPhone = normalizePhone(phone);
    if (!businessId || !normalizedPhone) throw new AppError("businessId e phone são obrigatórios");
    await assertPhoneVerifiedRecently(normalizedPhone);
    const appointments = await getAppointmentsByClientPhone(normalizedPhone, Number(businessId), { upcomingOnly: true });
    res.json(appointments.map(toApiAppointment));
  } catch (err) {
    next(err);
  }
});

appointmentsRouter.get("/api/public/appointment-history", selfServiceRateLimiter, async (req, res, next) => {
  try {
    const { businessId, phone } = req.query;
    const normalizedPhone = normalizePhone(phone);
    if (!businessId || !normalizedPhone) throw new AppError("businessId e phone são obrigatórios");
    await assertPhoneVerifiedRecently(normalizedPhone);
    const appointments = await getClientAppointmentHistory(normalizedPhone, Number(businessId));
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
    const { businessId, phone, professionalId, serviceId, date, startTime } = req.body || {};
    const normalizedPhone = normalizePhone(phone);
    if (!businessId || !normalizedPhone || !professionalId || !serviceId || !date || !startTime) {
      throw new AppError("businessId, phone, professionalId, serviceId, date e startTime são obrigatórios");
    }
    const client = await getClientByPhone(normalizedPhone);
    if (!client) throw new AppError("Cliente não encontrado", 404);
    const appointment = await createAppointment({
      businessId: Number(businessId),
      professionalId: Number(professionalId),
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
    const { businessId, professionalId, serviceId, date } = req.query;
    if (!businessId || !professionalId || !serviceId || !date) {
      throw new AppError("businessId, professionalId, serviceId e date são obrigatórios");
    }
    res.json(await getAvailableSlots(Number(businessId), Number(professionalId), Number(serviceId), String(date)));
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
    await assertPhoneVerifiedRecently(normalizedPhone);
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
    await assertPhoneVerifiedRecently(normalizedPhone);
    const { newDate, newStartTime } = req.body || {};
    if (!newDate || !newStartTime) throw new AppError("newDate e newStartTime são obrigatórios");
    res.json(toApiAppointment(await rescheduleAppointment(appointment.id, newDate, newStartTime)));
  } catch (err) {
    next(err);
  }
});

// Clique no link enviado junto do lembrete automático (~1 dia antes) —
// distinção agendado (scheduled) vs. confirmado (confirmed). Confirma
// direto no servidor e redireciona pra uma página estática de resultado,
// mesmo padrão de GET /api/verify-email (onboarding.routes.ts) — sem
// checagem de telefone de propósito: o token (32 bytes aleatórios, ver
// generateVerificationToken) já é a credencial, igual ao link de
// redefinição de senha; confirmar presença não é sensível o bastante pra
// justificar pedir o telefone de novo depois de já ter vindo de uma
// mensagem do WhatsApp da própria barbearia.
appointmentsRouter.get("/api/public/appointments/confirm", selfServiceRateLimiter, async (req, res) => {
  const token = String(req.query?.token || "").trim();
  if (!token) return res.redirect("/confirmar.html?status=invalid");
  try {
    await confirmAppointmentByToken(token);
    res.redirect("/confirmar.html?status=ok");
  } catch {
    res.redirect("/confirmar.html?status=invalid");
  }
});

appointmentsRouter.get("/api/appointments/:id/ics", selfServiceRateLimiter, async (req, res, next) => {
  try {
    const appointment = await getAppointmentByIdRaw(Number(req.params.id));
    const normalizedPhone = normalizePhone(req.query?.phone);
    if (!appointment || !normalizedPhone || appointment.clientPhone !== normalizedPhone) {
      return res.status(404).send("Agendamento não encontrado");
    }
    await assertPhoneVerifiedRecently(normalizedPhone);

    const ics = generateIcs(appointment);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="agendamento-${appointment.id}.ics"`);
    res.send(ics);
  } catch (err) {
    next(err);
  }
});

/* ---------------- Painel do dono (protegido) ---------------- */

appointmentsRouter.get("/api/appointments", requireAuth, requireOwner, async (req, res) => {
  const { professionalId, date } = req.query;
  const appointments = await getAppointments({
    businessId: req.session.user!.businessId,
    professionalId: professionalId ? Number(professionalId) : undefined,
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
    const { clientName, clientPhone, professionalId, serviceId, date, startTime } = req.body || {};
    const normalizedPhone = normalizePhone(clientPhone);
    if (!clientName || !String(clientName).trim() || !normalizedPhone || !serviceId || !date || !startTime) {
      throw new AppError(`Nome do ${vertical.client}, telefone, serviço, data e horário são obrigatórios`);
    }

    // Barbeiro só cria agendamento pra si mesmo — professionalId do corpo é
    // ignorado nesse caso (evita marcar em nome de outro barbeiro).
    let targetBarberId = req.session.user!.role === "professional" ? req.session.user!.professionalId! : Number(professionalId);
    if (!targetBarberId) throw new AppError("Barbeiro é obrigatório");

    const client = await findOrCreateClient(String(clientName).trim(), normalizedPhone);
    const appointment = await createAppointment({
      businessId: req.session.user!.businessId,
      professionalId: targetBarberId,
      serviceId: Number(serviceId),
      clientId: client.id,
      date,
      startTime,
    });
    await logAudit(
      req.session.user!.businessId,
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
    if (req.session.user!.role === "professional" && appointment!.professionalId !== req.session.user!.professionalId) {
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
    if (req.session.user!.role === "professional" && appointment!.professionalId !== req.session.user!.professionalId) {
      throw new AppError("Você só pode editar seus próprios agendamentos", 403);
    }
    const { clientName, serviceId, status, productSales, notes, paymentMethod, couponCode } = req.body || {};
    if (status && !["confirmed", "no_show"].includes(status)) throw new AppError("status inválido");

    const sales = Array.isArray(productSales) ? productSales : [];
    for (const s of sales) {
      if (!s.productId) continue;
      const product = await getProduct(Number(s.productId));
      if (!belongsToSession(req, product)) throw new AppError("Produto inválido");
    }

    const updated = await updateAppointmentDetails(Number(req.params.id), { clientName, serviceId, status, notes, paymentMethod, couponCode });
    const soldProducts = await replaceAppointmentProductSales(
      req.session.user!.businessId,
      updated.clientId,
      updated.id,
      updated.date,
      sales.map((s: any) => ({ productId: Number(s.productId), quantity: Number(s.quantity) || 1 })),
      req.session.user!.name,
      updated.paymentMethod as "dinheiro" | "pix" | "cartao" | "outro" | null
    );
    const productsSummary = soldProducts.map((s) => `${s.quantity}x ${s.productName}`).join(", ");
    await logAudit(
      req.session.user!.businessId,
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
    if (req.session.user!.role === "professional" && appointment!.professionalId !== req.session.user!.professionalId) {
      throw new AppError("Você só pode excluir seus próprios agendamentos", 403);
    }
    await cancelAppointment(appointment!.id);
    await logAudit(
      req.session.user!.businessId,
      req.session.user!.name,
      "Excluiu agendamento",
      `#${appointment!.id} — ${appointment!.clientName} (${appointment!.serviceName})`
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
