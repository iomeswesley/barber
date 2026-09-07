import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
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
    // Weekday 0 (domingo) até tarde da noite — 2026-09-06 é domingo, usado no
    // teste de fuso horário abaixo. Sem isso getBusinessHoursForDate acha nada
    // pra shopA nesse weekday e getAvailableSlots retornaria [] por esse
    // motivo, mascarando o que o teste realmente quer provar.
    await prisma.businessHours.create({ data: { businessId: shopA.id, weekday: 0, opensAt: "00:00", closesAt: "23:59", closed: false } });
  });

  afterAll(async () => {
    await prisma.businessHours.deleteMany({ where: { businessId: shopA.id } });
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

  // Achado em produção (2026-09-04, Barbearia Vintage): a IA errou o cálculo
  // de "amanhã" numa sessão de conversa longa/antiga e tentou agendar num
  // dia já passado — sem essa checagem, getAvailableSlots devolvia a lista
  // normal de horários (só filtrava horário já passado DENTRO do dia de
  // hoje, não o dia inteiro) e createAppointment aceitava numa boa.
  describe("data no passado (achado em produção 2026-09-04)", () => {
    it("getAvailableSlots retorna vazio pra uma data inteira no passado", async () => {
      const slots = await getAvailableSlots(shopA.id, barberA.id, serviceA.id, "2020-01-01");
      expect(slots).toEqual([]);
    });

    it("createAppointment rejeita mesmo sem passar por getAvailableSlots antes", async () => {
      await expect(
        createAppointment({
          businessId: shopA.id,
          professionalId: barberA.id,
          serviceId: serviceA.id,
          clientId: client.id,
          date: "2020-01-01",
          startTime: "10:00",
        })
      ).rejects.toThrow("data que já passou");
    });
  });

  // Achado em produção (2026-09-06, 22h13 em Brasília): "hoje" era calculado
  // com toISOString().slice(0,10), que é sempre UTC — às 22h13 em Brasília
  // (UTC-3) já era 01h13 UTC do dia seguinte, então o próprio dia de hoje
  // era rejeitado como "data que já passou" e a IA calculava "amanhã" dois
  // dias à frente do real. Corrigido usando localDateStr (getters de Date
  // que respeitam TZ=America/Sao_Paulo, setado em src/lib/timezone.ts).
  describe("cálculo de 'hoje' respeita o fuso de Brasília, não UTC (achado em produção 2026-09-06)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("createAppointment NÃO rejeita o próprio dia de hoje quando são 22h13 em Brasília (01h13 UTC do dia seguinte)", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-06T22:13:00-03:00"));

      const appt = await createAppointment({
        businessId: shopA.id,
        professionalId: barberA.id,
        serviceId: serviceA.id,
        clientId: client.id,
        date: "2026-09-06", // "hoje" local, mesmo já sendo 2026-09-07 em UTC
        startTime: "23:00",
      });
      expect(appt.date).toBe("2026-09-06");

      await prisma.appointment.delete({ where: { id: appt.id } });
    });

    it("getAvailableSlots NÃO trata o dia de hoje como passado quando são 22h13 em Brasília", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-06T22:13:00-03:00"));

      // shopA funciona até 23:59 no domingo (ver beforeAll). Sem a correção,
      // "date < todayIso" comparava "2026-09-06" (pedido) com "2026-09-07"
      // (UTC, errado) e retornava [] mecanicamente — mesmo com horário livre
      // de verdade às 22:30. Com a correção, o dia de hoje é reconhecido
      // como hoje e o slot das 22:30 aparece normalmente.
      const slots = await getAvailableSlots(shopA.id, barberA.id, serviceA.id, "2026-09-06");
      expect(slots).toContain("22:30");
    });
  });
});
