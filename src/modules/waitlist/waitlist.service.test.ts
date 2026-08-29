import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma.js";
import { createWaitlistEntry } from "./waitlist.repository.js";
import { cancelAppointment, createAppointment } from "@/modules/appointments/appointments.service.js";

// Teste de integração: banco real, dados "[teste]". Sem WHATSAPP_ACCESS_TOKEN
// configurado no ambiente de teste, notifyWaitlistForFreedSlot cai no stub
// (só loga), então isso testa a parte que importa sem depender de rede: quem
// entra na lista de espera é encontrado no cancelamento certo e vira "notificado".
describe("waitlist (entrar na lista + notificação no cancelamento)", () => {
  let business: { id: number };
  let barber: { id: number };
  let otherBarber: { id: number };
  let service: { id: number };
  let waitingClient: { id: number };
  let bookingClient: { id: number };

  beforeAll(async () => {
    business = await prisma.business.create({ data: { name: "[teste] Waitlist Shop" } });
    barber = await prisma.professional.create({ data: { businessId: business.id, name: "[teste] Barbeiro Waitlist" } });
    otherBarber = await prisma.professional.create({ data: { businessId: business.id, name: "[teste] Outro Barbeiro" } });
    service = await prisma.service.create({ data: { businessId: business.id, name: "[teste] Corte Waitlist", priceCents: 5000, durationMin: 30 } });
    waitingClient = await prisma.client.create({ data: { name: "[teste] Cliente Espera", phone: `teste-wait-${Date.now()}` } });
    bookingClient = await prisma.client.create({ data: { name: "[teste] Cliente Agenda", phone: `teste-book-${Date.now()}` } });
  });

  afterAll(async () => {
    await prisma.waitlistEntry.deleteMany({ where: { businessId: business.id } });
    await prisma.appointment.deleteMany({ where: { businessId: business.id } });
    await prisma.client.deleteMany({ where: { id: { in: [waitingClient.id, bookingClient.id] } } });
    await prisma.service.deleteMany({ where: { id: service.id } });
    await prisma.professional.deleteMany({ where: { id: { in: [barber.id, otherBarber.id] } } });
    await prisma.business.deleteMany({ where: { id: business.id } });
  });

  it("marca como notificado quando o horário liberado bate com o período/profissional pedido", async () => {
    const futureDate = "2099-06-10";
    const entry = await createWaitlistEntry(business.id, {
      clientId: waitingClient.id,
      professionalId: barber.id,
      serviceId: service.id,
      desiredDateStart: "2099-06-08",
      desiredDateEnd: "2099-06-12",
    });

    const appointment = await createAppointment({
      businessId: business.id,
      professionalId: barber.id,
      serviceId: service.id,
      clientId: bookingClient.id,
      date: futureDate,
      startTime: "10:00",
    });
    await cancelAppointment(appointment.id);

    const updated = await prisma.waitlistEntry.findUnique({ where: { id: entry.id } });
    expect(updated?.status).toBe("notificado");
    expect(updated?.notifiedAt).not.toBeNull();
  });

  it("não notifica quem pediu outro profissional", async () => {
    const futureDate = "2099-07-10";
    const entry = await createWaitlistEntry(business.id, {
      clientId: waitingClient.id,
      professionalId: otherBarber.id, // pediu o OUTRO barbeiro
      serviceId: service.id,
      desiredDateStart: "2099-07-08",
      desiredDateEnd: "2099-07-12",
    });

    const appointment = await createAppointment({
      businessId: business.id,
      professionalId: barber.id, // cancelamento é do barbeiro que ela NÃO pediu
      serviceId: service.id,
      clientId: bookingClient.id,
      date: futureDate,
      startTime: "11:00",
    });
    await cancelAppointment(appointment.id);

    const updated = await prisma.waitlistEntry.findUnique({ where: { id: entry.id } });
    expect(updated?.status).toBe("aguardando");
  });

  it("não notifica quem pediu um período diferente", async () => {
    const futureDate = "2099-08-20";
    const entry = await createWaitlistEntry(business.id, {
      clientId: waitingClient.id,
      professionalId: barber.id,
      serviceId: service.id,
      desiredDateStart: "2099-08-01",
      desiredDateEnd: "2099-08-05", // não cobre 08-20
    });

    const appointment = await createAppointment({
      businessId: business.id,
      professionalId: barber.id,
      serviceId: service.id,
      clientId: bookingClient.id,
      date: futureDate,
      startTime: "12:00",
    });
    await cancelAppointment(appointment.id);

    const updated = await prisma.waitlistEntry.findUnique({ where: { id: entry.id } });
    expect(updated?.status).toBe("aguardando");
  });
});
