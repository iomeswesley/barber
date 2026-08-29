import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma.js";
import { createAppointment, updateAppointmentDetails } from "@/modules/appointments/appointments.service.js";
import { createCoupon } from "./coupons.repository.js";

// Teste de integração: banco real, dados "[teste]". Cobre a aplicação de
// cupom via updateAppointmentDetails (editar agendamento no painel) — o
// caminho real usado pelo formulário, não a rota HTTP direto.
describe("aplicar cupom a um agendamento (updateAppointmentDetails)", () => {
  let business: { id: number };
  let barber: { id: number };
  let service: { id: number };
  let client: { id: number };

  beforeAll(async () => {
    business = await prisma.business.create({ data: { name: "[teste] Coupon Shop" } });
    barber = await prisma.professional.create({ data: { businessId: business.id, name: "[teste] Barbeiro Cupom" } });
    service = await prisma.service.create({ data: { businessId: business.id, name: "[teste] Corte Cupom", priceCents: 10000, durationMin: 30 } });
    client = await prisma.client.create({ data: { name: "[teste] Cliente Cupom", phone: `teste-coupon-${Date.now()}` } });
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { businessId: business.id } });
    await prisma.coupon.deleteMany({ where: { businessId: business.id } });
    await prisma.client.deleteMany({ where: { id: client.id } });
    await prisma.service.deleteMany({ where: { id: service.id } });
    await prisma.professional.deleteMany({ where: { id: barber.id } });
    await prisma.business.deleteMany({ where: { id: business.id } });
  });

  it("aplica desconto percentual e incrementa used_count", async () => {
    const coupon = await createCoupon(business.id, { code: "TESTE20", discountType: "percent", discountValue: 20 });
    const appointment = await createAppointment({
      businessId: business.id,
      professionalId: barber.id,
      serviceId: service.id,
      clientId: client.id,
      date: "2099-05-01",
      startTime: "09:00",
    });

    const updated = await updateAppointmentDetails(appointment.id, { couponCode: "teste20" }); // caixa baixa, o service normaliza
    expect(updated.priceCents).toBe(8000); // 10000 - 20%
    expect(updated.couponId).toBe(coupon.id);

    const refreshed = await prisma.coupon.findUnique({ where: { id: coupon.id } });
    expect(refreshed?.usedCount).toBe(1);
  });

  it("aplica desconto fixo (centavos)", async () => {
    await createCoupon(business.id, { code: "TESTE1500", discountType: "fixed", discountValue: 1500 });
    const appointment = await createAppointment({
      businessId: business.id,
      professionalId: barber.id,
      serviceId: service.id,
      clientId: client.id,
      date: "2099-05-02",
      startTime: "09:00",
    });

    const updated = await updateAppointmentDetails(appointment.id, { couponCode: "TESTE1500" });
    expect(updated.priceCents).toBe(8500); // 10000 - 1500
  });

  it("rejeita cupom inativo", async () => {
    const coupon = await createCoupon(business.id, { code: "INATIVO", discountType: "percent", discountValue: 10 });
    await prisma.coupon.update({ where: { id: coupon.id }, data: { active: false } });
    const appointment = await createAppointment({
      businessId: business.id,
      professionalId: barber.id,
      serviceId: service.id,
      clientId: client.id,
      date: "2099-05-03",
      startTime: "09:00",
    });

    await expect(updateAppointmentDetails(appointment.id, { couponCode: "INATIVO" })).rejects.toThrow("Cupom inativo");
  });

  it("não deixa aplicar dois cupons no mesmo agendamento", async () => {
    await createCoupon(business.id, { code: "PRIMEIRO", discountType: "percent", discountValue: 10 });
    await createCoupon(business.id, { code: "SEGUNDO", discountType: "percent", discountValue: 50 });
    const appointment = await createAppointment({
      businessId: business.id,
      professionalId: barber.id,
      serviceId: service.id,
      clientId: client.id,
      date: "2099-05-04",
      startTime: "09:00",
    });

    const first = await updateAppointmentDetails(appointment.id, { couponCode: "PRIMEIRO" });
    expect(first.priceCents).toBe(9000);

    // Reenviar com outro código não deve empilhar desconto (couponId já setado).
    const second = await updateAppointmentDetails(appointment.id, { couponCode: "SEGUNDO" });
    expect(second.priceCents).toBe(9000);
  });
});
