import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/middleware/errorHandler.js";
import { timeToMinutes, minutesToTime, localDateStr, normalizePhone } from "@/lib/time.js";
import { getBarbershop, getBusinessHoursForDate } from "@/modules/businesses/businesses.repository.js";
import { getService } from "@/modules/services/services.repository.js";
import { getBarber } from "@/modules/professionals/professionals.repository.js";
import { getBlocksFor } from "@/modules/timeBlocks/timeBlocks.repository.js";
import { getClientByPhone } from "@/modules/clients/clients.repository.js";
import { resolveChargedPrice } from "@/modules/clientPlans/clientPlans.service.js";
import { decrementUsedThisPeriod } from "@/modules/clientPlans/clientPlans.repository.js";
import { getCouponByCode, couponIsValidNow, incrementCouponUsage } from "@/modules/coupons/coupons.repository.js";
import { notifyWaitlistForFreedSlot } from "@/modules/waitlist/waitlist.service.js";
import { mirrorAppointmentToGoogle, removeAppointmentFromGoogle } from "@/modules/googleCalendar/googleCalendar.service.js";
import {
  getAppointmentById,
  getAppointments,
  insertAppointment,
  findConflict,
  cancelAppointment as cancelAppointmentRow,
  updateAppointmentFields,
  updateClientName,
  setConfirmationToken,
  confirmAppointmentByToken as confirmAppointmentByTokenRow,
} from "./appointments.repository.js";
import { appointmentInclude, toAppointmentDTO, type AppointmentDTO, type AppointmentWithRelations } from "./appointments.types.js";
import { generateVerificationToken } from "@/lib/email.js";

export async function getAvailableSlots(
  businessId: number,
  professionalId: number,
  serviceId: number,
  date: string
): Promise<string[]> {
  const [shop, service, barber] = await Promise.all([getBarbershop(businessId), getService(serviceId), getBarber(professionalId)]);
  if (!shop || !service || service.businessId !== businessId) return [];
  if (!barber || barber.businessId !== businessId) return [];

  const hours = await getBusinessHoursForDate(businessId, date);
  if (!hours || hours.closed) return [];

  const openMin = timeToMinutes(hours.opensAt);
  const closeMin = timeToMinutes(hours.closesAt);
  const duration = service.durationMin;

  const existing = await prisma.appointment.findMany({
    where: { professionalId, date: new Date(`${date}T00:00:00`), status: { not: "cancelled" } },
    select: { startTime: true, endTime: true },
  });
  const busy = existing.map((a) => ({ start: timeToMinutes(a.startTime), end: timeToMinutes(a.endTime) }));
  busy.push(...(await getBlocksFor(businessId, professionalId, date)));

  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  // Data inteira já passada (não só "mais cedo hoje") nunca tem horário
  // livre — sem essa checagem, um "amanhã" mal calculado pela IA (ex:
  // confundiu com um mês anterior, achado em produção 2026-09-04) voltava
  // a lista normal de horários do dia, como se fosse uma data futura
  // válida, e o agendamento passava sem ninguém perceber o erro.
  if (date < todayIso) return [];
  const isToday = date === todayIso;
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const slots: string[] = [];
  for (let start = openMin; start + duration <= closeMin; start += 30) {
    if (isToday && start <= nowMin) continue;
    const end = start + duration;
    const overlaps = busy.some((b) => start < b.end && end > b.start);
    if (!overlaps) slots.push(minutesToTime(start));
  }
  return slots;
}

// Varre dia a dia (pulando dias em que a barbearia está fechada) até achar a
// próxima data com horários livres — evita o modelo de IA ficar chutando uma
// data por vez e queimando uma tool call por tentativa.
export async function findNextAvailableDay(
  businessId: number,
  professionalId: number,
  serviceId: number,
  fromDateStr: string,
  maxDays = 14
): Promise<{ date: string; horarios_disponiveis: string[] } | null> {
  const start = new Date(`${fromDateStr}T12:00:00`);
  for (let offset = 0; offset < maxDays; offset++) {
    const day = new Date(start);
    day.setDate(day.getDate() + offset);
    const dateStr = localDateStr(day);
    const slots = await getAvailableSlots(businessId, professionalId, serviceId, dateStr);
    if (slots.length > 0) return { date: dateStr, horarios_disponiveis: slots };
  }
  return null;
}

export async function createAppointment(input: {
  businessId: number;
  professionalId: number;
  serviceId: number;
  clientId: number;
  date: string;
  startTime: string;
}): Promise<AppointmentDTO> {
  // Segunda linha de defesa (a primeira é getAvailableSlots, mas o bot
  // também pode chamar criar_agendamento direto sem checar disponibilidade
  // antes) — nunca aceitar uma data que já passou. Acontece na prática: a
  // IA errou o cálculo de "amanhã" (achado em produção 2026-09-04, virou
  // um mês inteiro pra trás) e criou um agendamento fantasma sem ninguém
  // perceber até o dono ir olhar a agenda.
  const todayIso = new Date().toISOString().slice(0, 10);
  if (input.date < todayIso) throw new AppError("Não é possível agendar em uma data que já passou.");

  const [service, barber] = await Promise.all([getService(input.serviceId), getBarber(input.professionalId)]);
  if (!service || service.businessId !== input.businessId) throw new AppError("Serviço não encontrado", 404);
  if (!barber || barber.businessId !== input.businessId) throw new AppError("Barbeiro não encontrado", 404);
  const endTime = minutesToTime(timeToMinutes(input.startTime) + service.durationMin);

  const conflict = await findConflict(input.professionalId, input.date, input.startTime, endTime);
  if (conflict) {
    throw new AppError("Esse horário acabou de ser ocupado. Escolha outro horário.");
  }

  const startMin = timeToMinutes(input.startTime);
  const endMin = timeToMinutes(endTime);
  const blocks = await getBlocksFor(input.businessId, input.professionalId, input.date);
  const blocked = blocks.some((b) => startMin < b.end && endMin > b.start);
  if (blocked) {
    throw new AppError("Esse horário está bloqueado (folga, feriado ou intervalo). Escolha outro horário.");
  }

  // Se o cliente tem uma assinatura de plano ativa nessa barbearia que se
  // aplica a esse serviço, o preço cobrado reflete o benefício (desconto ou
  // grátis) — vale pros três canais de agendamento (WhatsApp, autoatendimento
  // público e manual do dono/barbeiro), já que todos passam por aqui.
  const charge = await resolveChargedPrice(input.clientId, input.businessId, input.serviceId, service.priceCents);

  const created = await insertAppointment({
    ...input,
    endTime,
    // Sempre congela um valor concreto aqui, mesmo sem plano de assinatura
    // (charge.priceChargedCents null) — sem isso, o preço ficava null e era
    // lido ao vivo de Service.priceCents em toda consulta de histórico
    // (appointments.types.ts), fazendo qualquer alteração de preço do
    // serviço reescrever retroativamente o valor de agendamentos passados.
    priceChargedCents: charge.priceChargedCents ?? service.priceCents,
    clientPlanSubscriptionId: charge.subscriptionId,
    planCreditConsumed: charge.creditConsumed,
  });
  // Espelhar no Google Agenda do barbeiro (se conectado) nunca quebra o
  // agendamento em si — mirrorAppointmentToGoogle engole qualquer erro
  // internamente e só loga. Precisa de `await` (não fire-and-forget) porque
  // o processo roda como função serverless na Vercel: assim que a resposta
  // HTTP é enviada, a execução pode ser congelada a qualquer momento, e uma
  // Promise solta nunca chegaria a completar a chamada de rede pro Google.
  await mirrorAppointmentToGoogle(created);
  return created;
}

export async function rescheduleAppointment(id: number, newDate: string, newStartTime: string): Promise<AppointmentDTO> {
  const appointment = await getAppointmentById(id);
  if (!appointment) throw new AppError("Agendamento não encontrado", 404);

  const service = await getService(appointment.serviceId);
  if (!service) throw new AppError("Serviço não encontrado", 404);
  const newEndTime = minutesToTime(timeToMinutes(newStartTime) + service.durationMin);

  const conflict = await findConflict(appointment.professionalId, newDate, newStartTime, newEndTime, id);
  if (conflict) throw new AppError("Esse novo horário já está ocupado. Escolha outro.");

  const startMin = timeToMinutes(newStartTime);
  const endMin = timeToMinutes(newEndTime);
  const blocks = await getBlocksFor(appointment.businessId, appointment.professionalId, newDate);
  const blocked = blocks.some((b) => startMin < b.end && endMin > b.start);
  if (blocked) throw new AppError("Esse novo horário está bloqueado (folga, feriado ou intervalo). Escolha outro.");

  await prisma.appointment.update({
    where: { id },
    data: { date: new Date(`${newDate}T00:00:00`), startTime: newStartTime, endTime: newEndTime },
  });
  const rescheduled = (await getAppointmentById(id))!;
  // Se já existia evento espelhado (googleEventId), isso vira um PATCH no
  // Google (mesmo evento, novo horário) em vez de criar um segundo.
  // `await` pelo mesmo motivo de createAppointment: serverless na Vercel
  // pode congelar a execução assim que a resposta HTTP sai.
  await mirrorAppointmentToGoogle(rescheduled);
  return rescheduled;
}

export async function cancelAppointment(id: number): Promise<AppointmentDTO> {
  const cancelled = await cancelAppointmentRow(id);
  // Devolve a cota consumida do plano (benefício services_included) pra não
  // penalizar o cliente por um agendamento que nem aconteceu.
  if (cancelled.planCreditConsumed && cancelled.clientPlanSubscriptionId) {
    await decrementUsedThisPeriod(cancelled.clientPlanSubscriptionId);
  }
  const result = (await getAppointmentById(id))!;
  // `await` pelo mesmo motivo de createAppointment (serverless na Vercel).
  await removeAppointmentFromGoogle(result);
  // Best-effort: nunca deve impedir o cancelamento em si de completar, mesmo
  // se o envio de WhatsApp falhar — notifyWaitlistForFreedSlot já engole erro
  // de envio internamente, isso aqui só protege contra qualquer outra falha
  // inesperada (ex: erro de banco ao buscar a lista).
  try {
    await notifyWaitlistForFreedSlot(result.businessId, result.professionalId, result.serviceId, result.date, result.startTime);
  } catch (err) {
    console.error("[WAITLIST] Falha ao processar lista de espera após cancelamento:", (err as Error).message);
  }
  return result;
}

// Usado quando um bloqueio de última hora é criado, pra achar agendamentos já
// feitos que passam a cair dentro da janela bloqueada, pra avisar os clientes.
export async function getAffectedAppointments(
  businessId: number,
  professionalId: number | null,
  date: string,
  startTime: string,
  endTime: string
): Promise<AppointmentDTO[]> {
  const now = new Date();
  const all = await getAppointments({ businessId, professionalId: professionalId || undefined, date });
  const endMin = timeToMinutes(endTime);
  const startMin = timeToMinutes(startTime);
  return all
    // "scheduled" e "confirmed" são os dois status de agendamento válido
    // (a diferença é só se o cliente já confirmou pelo link do lembrete) —
    // os dois precisam ser avisados se um bloqueio de última hora cair em
    // cima do horário deles.
    .filter((a) => a.status === "confirmed" || a.status === "scheduled")
    .filter((a) => timeToMinutes(a.startTime) < endMin && timeToMinutes(a.endTime) > startMin)
    .filter((a) => new Date(`${a.date}T${a.startTime}:00`) > now);
}

export async function updateAppointmentDetails(
  id: number,
  {
    clientName,
    serviceId,
    status,
    notes,
    paymentMethod,
    couponCode,
  }: {
    clientName?: string;
    serviceId?: number | string;
    status?: string;
    notes?: string;
    paymentMethod?: string;
    couponCode?: string;
  }
): Promise<AppointmentDTO> {
  const appointment = await getAppointmentById(id);
  if (!appointment) throw new AppError("Agendamento não encontrado", 404);

  if (clientName && clientName.trim()) {
    await updateClientName(appointment.clientId, clientName.trim());
  }

  if (serviceId && Number(serviceId) !== appointment.serviceId) {
    const service = await getService(Number(serviceId));
    if (!service || service.businessId !== appointment.businessId) throw new AppError("Serviço não encontrado");
    const newEndTime = minutesToTime(timeToMinutes(appointment.startTime) + service.durationMin);
    await updateAppointmentFields(id, { serviceId: Number(serviceId), endTime: newEndTime });
  }

  if (status && ["confirmed", "no_show"].includes(status)) {
    await updateAppointmentFields(id, { status: status as "confirmed" | "no_show" });
  }

  // undefined = campo nem enviado, não mexe; string vazia vira null no banco,
  // distinguindo "sem nota" de payload incompleto.
  if (notes !== undefined) {
    await updateAppointmentFields(id, { notes: notes.trim() || null });
  }

  if (paymentMethod !== undefined) {
    const allowed = ["dinheiro", "pix", "cartao", "outro"];
    if (paymentMethod && !allowed.includes(paymentMethod)) throw new AppError("Forma de pagamento inválida");
    await updateAppointmentFields(id, { paymentMethod: (paymentMethod || null) as any });
  }

  // Cupom só pode ser aplicado uma vez por agendamento (evita empilhar
  // desconto reenviando o mesmo código em edições sucessivas) — reenviar o
  // mesmo agendamento com couponCode depois de já ter cupom é ignorado
  // silenciosamente, não é erro (o formulário do painel manda o campo em
  // branco depois de aplicado, então isso raramente dispara).
  if (couponCode && couponCode.trim() && !appointment.clientPlanSubscriptionId && appointment.couponId == null) {
    const coupon = await getCouponByCode(appointment.businessId, couponCode.trim().toUpperCase());
    if (!coupon) throw new AppError("Cupom não encontrado");
    const check = couponIsValidNow(coupon);
    if (!check.valid) throw new AppError(check.reason || "Cupom inválido");

    const currentServiceId = serviceId ? Number(serviceId) : appointment.serviceId;
    const service = await getService(currentServiceId);
    if (!service) throw new AppError("Serviço não encontrado");
    const basePriceCents = service.priceCents;
    const discountCents =
      coupon.discountType === "percent" ? Math.round((basePriceCents * coupon.discountValue) / 100) : coupon.discountValue;
    const finalPriceCents = Math.max(0, basePriceCents - discountCents);

    await updateAppointmentFields(id, { couponId: coupon.id, priceChargedCents: finalPriceCents });
    await incrementCouponUsage(coupon.id);
  }

  return (await getAppointmentById(id))!;
}

export async function getAppointmentsByClientPhone(
  clientPhone: string,
  businessId: number,
  { upcomingOnly = true } = {}
): Promise<AppointmentDTO[]> {
  const client = await getClientByPhone(clientPhone);
  if (!client) return [];
  const now = new Date();
  const appointments = await prisma.appointment.findMany({
    where: {
      status: { not: "cancelled" },
      clientId: client.id,
      businessId,
      ...(upcomingOnly
        ? {
            OR: [
              { date: { gt: new Date(`${localDateStr(now)}T00:00:00`) } },
              {
                date: new Date(`${localDateStr(now)}T00:00:00`),
                endTime: { gt: `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}` },
              },
            ],
          }
        : {}),
    },
    include: appointmentInclude,
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
  return appointments.map((a) => toAppointmentDTO(a as AppointmentWithRelations));
}

// Agendamentos passados (que já aconteceram) pro histórico de autoatendimento do
// cliente — distinto de getAppointmentsByClientPhone(upcomingOnly:true), que só olha pra frente.
export async function getClientAppointmentHistory(
  clientPhone: string,
  businessId: number,
  limit = 20
): Promise<AppointmentDTO[]> {
  const client = await getClientByPhone(clientPhone);
  if (!client) return [];
  const now = new Date();
  const todayDate = new Date(`${localDateStr(now)}T00:00:00`);
  const nowTimeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

  const appointments = await prisma.appointment.findMany({
    where: {
      clientId: client.id,
      businessId,
      status: { not: "cancelled" },
      OR: [{ date: { lt: todayDate } }, { date: todayDate, endTime: { lte: nowTimeStr } }],
    },
    include: appointmentInclude,
    orderBy: [{ date: "desc" }, { startTime: "desc" }],
    take: limit,
  });
  return appointments.map((a) => toAppointmentDTO(a as AppointmentWithRelations));
}

export async function getClientLastAppointment(clientId: number, businessId: number): Promise<AppointmentDTO | null> {
  const now = new Date();
  const todayDate = new Date(`${localDateStr(now)}T00:00:00`);
  const nowTimeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  const appointment = await prisma.appointment.findFirst({
    where: {
      clientId,
      businessId,
      // "scheduled" entra aqui também: a maioria dos agendamentos passados
      // nunca chega a ser clicada no link de confirmação (o cliente só
      // recebe o lembrete ~1 dia antes), então filtrar só "confirmed" faria
      // "última visita" sumir pra praticamente todo mundo.
      status: { in: ["confirmed", "scheduled"] },
      OR: [{ date: { lt: todayDate } }, { date: todayDate, endTime: { lte: nowTimeStr } }],
    },
    include: appointmentInclude,
    orderBy: [{ date: "desc" }, { startTime: "desc" }],
  });
  return appointment ? toAppointmentDTO(appointment as AppointmentWithRelations) : null;
}

export async function getAppointmentsNeedingReminder(windowStartMin = 55, windowEndMin = 65): Promise<AppointmentDTO[]> {
  const now = new Date();
  const from = new Date(now.getTime() + windowStartMin * 60000);
  const to = new Date(now.getTime() + windowEndMin * 60000);

  // Compara "YYYY-MM-DD HH:MM" como string pra achar agendamentos cujo início cai
  // dentro da janela de 55–65 min a partir de agora, cruzando fronteiras de dia.
  const fromStr = `${localDateStr(from)} ${from.getHours().toString().padStart(2, "0")}:${from.getMinutes().toString().padStart(2, "0")}`;
  const toStr = `${localDateStr(to)} ${to.getHours().toString().padStart(2, "0")}:${to.getMinutes().toString().padStart(2, "0")}`;

  const appointments = await prisma.appointment.findMany({
    where: { status: { not: "cancelled" }, reminderSentAt: null },
    include: appointmentInclude,
  });
  return appointments
    .map((a) => toAppointmentDTO(a as AppointmentWithRelations))
    .filter((a) => {
      const key = `${a.date} ${a.startTime}`;
      return key >= fromStr && key <= toStr;
    });
}

// Usado pelo cron diário (Vercel Cron roda no máximo 1x/dia no plano Hobby):
// pega todos os agendamentos de hoje ainda não avisados, em vez da janela
// de 55–65 min usada por getAppointmentsNeedingReminder (pensada pra um
// scheduler contínuo de 1 em 1 minuto).
export async function getTodaysAppointmentsForReminder(): Promise<AppointmentDTO[]> {
  const today = localDateStr(new Date());
  const appointments = await prisma.appointment.findMany({
    where: { status: { not: "cancelled" }, reminderSentAt: null, date: new Date(`${today}T00:00:00`) },
    include: appointmentInclude,
  });
  return appointments.map((a) => toAppointmentDTO(a as AppointmentWithRelations));
}

// Gera (ou reaproveita) o token de confirmação de um agendamento — chamado
// ao montar o lembrete automático, pra incluir o link "confirme sua
// presença" na mensagem. Reaproveita o token existente em reenvios (ex:
// sendDailyReminders rodando de novo) pra não invalidar um link que o
// cliente já recebeu.
export async function ensureConfirmationToken(appointment: AppointmentDTO): Promise<string> {
  if (appointment.confirmationToken) return appointment.confirmationToken;
  const token = generateVerificationToken();
  await setConfirmationToken(appointment.id, token);
  return token;
}

export async function confirmAppointmentByToken(token: string): Promise<AppointmentDTO> {
  const appointment = await confirmAppointmentByTokenRow(token);
  if (!appointment) throw new AppError("Link de confirmação inválido ou já usado.", 404);
  return appointment;
}

export async function getUnreviewedCompletedAppointment(clientPhone: string, businessId: number): Promise<AppointmentDTO | null> {
  const client = await getClientByPhone(normalizePhone(clientPhone) ? clientPhone : clientPhone);
  if (!client) return null;
  const now = new Date();
  const todayDate = new Date(`${localDateStr(now)}T00:00:00`);
  const nowTimeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  const appointment = await prisma.appointment.findFirst({
    where: {
      clientId: client.id,
      businessId,
      status: { not: "cancelled" },
      review: null,
      reviewPromptedAt: null,
      OR: [{ date: { lt: todayDate } }, { date: todayDate, endTime: { lte: nowTimeStr } }],
    },
    include: appointmentInclude,
    orderBy: [{ date: "desc" }, { endTime: "desc" }],
  });
  return appointment ? toAppointmentDTO(appointment as AppointmentWithRelations) : null;
}
