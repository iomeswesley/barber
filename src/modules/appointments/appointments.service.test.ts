import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma.js";
import { createAppointment, getAvailableSlots } from "./appointments.service.js";

// Teste de integração: usa o banco real (mesmo DATABASE_URL do resto do app).
// Cobre a correção do IDOR entre tenants: professionalId/serviceId de uma
// barbearia não podem ser usados pra criar um agendamento em outra.
describe("createAppointment / getAvailableSlots (isolamento entre tenants)", () => {
  let shopA: { id: number };
  let shopB: { id: number };
  let barberA: { id: number };
  let serviceA: { id: number };
  let barberB: { id: number };
  let serviceB: { id: number };
  let client: { id: number };

  beforeAll(async () => {
    shopA = await prisma.business.create({ data: { name: "[teste] Shop A" } });
    shopB = await prisma.business.create({ data: { name: "[teste] Shop B" } });
    barberA = await prisma.professional.create({ data: { businessId: shopA.id, name: "[teste] Barbeiro A", serviceCommissionPercent: 40 } });
    serviceA = await prisma.service.create({ data: { businessId: shopA.id, name: "[teste] Corte A", priceCents: 3000, durationMin: 30 } });
    barberB = await prisma.professional.create({ data: { businessId: shopB.id, name: "[teste] Barbeiro B", serviceCommissionPercent: 40 } });
    serviceB = await prisma.service.create({ data: { businessId: shopB.id, name: "[teste] Corte B", priceCents: 3000, durationMin: 30 } });
    client = await prisma.client.create({ data: { name: "[teste] Cliente", phone: `teste-${Date.now()}` } });
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { clientId: client.id } });
    await prisma.client.deleteMany({ where: { id: client.id } });
    await prisma.service.deleteMany({ where: { id: { in: [serviceA.id, serviceB.id] } } });
    await prisma.professional.deleteMany({ where: { id: { in: [barberA.id, barberB.id] } } });
    await prisma.business.deleteMany({ where: { id: { in: [shopA.id, shopB.id] } } });
  });

  it("rejeita agendamento com serviceId de outra barbearia", async () => {
    await expect(
      createAppointment({
        businessId: shopA.id,
        professionalId: barberA.id,
        serviceId: serviceB.id, // serviço pertence à Shop B
        clientId: client.id,
        date: "2099-01-01",
        startTime: "10:00",
      })
    ).rejects.toThrow("Serviço não encontrado");
  });

  it("rejeita agendamento com professionalId de outra barbearia", async () => {
    await expect(
      createAppointment({
        businessId: shopA.id,
        professionalId: barberB.id, // barbeiro pertence à Shop B
        serviceId: serviceA.id,
        clientId: client.id,
        date: "2099-01-01",
        startTime: "10:00",
      })
    ).rejects.toThrow("Barbeiro não encontrado");
  });

  it("aceita agendamento quando barbeiro e serviço pertencem à mesma barbearia", async () => {
    const appt = await createAppointment({
      businessId: shopA.id,
      professionalId: barberA.id,
      serviceId: serviceA.id,
      clientId: client.id,
      date: "2099-01-01",
      startTime: "10:00",
    });
    expect(appt.businessId).toBe(shopA.id);
  });

  it("getAvailableSlots retorna vazio se o serviço não pertence à barbearia informada", async () => {
    const slots = await getAvailableSlots(shopA.id, barberA.id, serviceB.id, "2099-01-02");
    expect(slots).toEqual([]);
  });

  it("getAvailableSlots retorna vazio se o barbeiro não pertence à barbearia informada", async () => {
    const slots = await getAvailableSlots(shopA.id, barberB.id, serviceA.id, "2099-01-02");
    expect(slots).toEqual([]);
  });
});
