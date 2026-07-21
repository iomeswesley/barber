import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma.js";
import { clientBelongsToShop, anonymizeClient } from "./clients.repository.js";

// Teste de integração: usa o banco real (mesmo DATABASE_URL do resto do
// app — este projeto não tem um banco de teste separado). Cria só os
// próprios registros num barbershop/client isolados e apaga tudo no final,
// pra não deixar lixo nem depender de dados do seed.
describe("clientBelongsToShop / anonymizeClient (integração)", () => {
  let shopA: { id: number };
  let shopB: { id: number };
  let barber: { id: number };
  let service: { id: number };
  let client: { id: number };
  let appointmentId: number;

  beforeAll(async () => {
    shopA = await prisma.barbershop.create({ data: { name: "[teste] Shop A" } });
    shopB = await prisma.barbershop.create({ data: { name: "[teste] Shop B" } });
    barber = await prisma.barber.create({
      data: { barbershopId: shopA.id, name: "[teste] Barbeiro", serviceCommissionPercent: 40 },
    });
    service = await prisma.service.create({
      data: { barbershopId: shopA.id, name: "[teste] Corte", priceCents: 3000, durationMin: 30 },
    });
    client = await prisma.client.create({ data: { name: "[teste] Cliente", phone: `teste-${Date.now()}` } });
    const appt = await prisma.appointment.create({
      data: {
        barbershopId: shopA.id,
        barberId: barber.id,
        serviceId: service.id,
        clientId: client.id,
        date: new Date(),
        startTime: "10:00",
        endTime: "10:30",
        status: "confirmed",
      },
    });
    appointmentId = appt.id;
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { id: appointmentId } });
    await prisma.client.deleteMany({ where: { id: client.id } });
    await prisma.service.deleteMany({ where: { id: service.id } });
    await prisma.barber.deleteMany({ where: { id: barber.id } });
    await prisma.barbershop.deleteMany({ where: { id: { in: [shopA.id, shopB.id] } } });
  });

  it("confirma vínculo na barbearia onde o cliente realmente tem agendamento", async () => {
    expect(await clientBelongsToShop(client.id, shopA.id)).toBe(true);
  });

  it("nega vínculo numa barbearia diferente (isolamento entre tenants)", async () => {
    expect(await clientBelongsToShop(client.id, shopB.id)).toBe(false);
  });

  it("anonimiza o cadastro sem quebrar a referência do agendamento existente", async () => {
    await anonymizeClient(client.id);
    const updated = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(updated.name).toBe("Cliente removido");
    expect(updated.marketingOptIn).toBe(false);
    expect(updated.birthday).toBeNull();

    const appt = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    expect(appt.clientId).toBe(client.id);
  });
});
