import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createApp } from "@/app.js";
import { prisma } from "@/lib/prisma.js";

// Cobre o hardening de identidade (2026-08-15): ver histórico, cancelar,
// reagendar e baixar o .ics de agendamento passaram a exigir o telefone ter
// passado pelo código OTP recente (assertPhoneVerifiedRecently) — antes
// bastava saber o telefone de alguém. Mocka o envio real de WhatsApp
// (sendWhatsappAuthTemplate) e semeia o PhoneVerification já confirmado
// direto no banco pra não depender de enviar/ler um código de verdade.
vi.mock("@/lib/whatsapp.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/whatsapp.js")>();
  return { ...actual, sendWhatsappAuthTemplate: vi.fn().mockResolvedValue(undefined) };
});

describe("proteção por OTP nas rotas públicas de agendamento", () => {
  const app = createApp();
  const phone = `5511999${Date.now().toString().slice(-6)}`;
  let business: { id: number };
  let client: { id: number };
  let service: { id: number };
  let professional: { id: number };
  let appointment: { id: number };

  beforeAll(async () => {
    business = await prisma.business.create({
      data: { name: "[teste] OTP Appointments", whatsappPhoneNumberId: `teste-phone-otp-${Date.now()}` },
    });
    client = await prisma.client.create({ data: { name: "[teste] Cliente OTP", phone } });
    service = await prisma.service.create({
      data: { businessId: business.id, name: "[teste] Corte", priceCents: 5000, durationMin: 30 },
    });
    professional = await prisma.professional.create({ data: { businessId: business.id, name: "[teste] Profissional" } });
    appointment = await prisma.appointment.create({
      data: {
        businessId: business.id,
        clientId: client.id,
        serviceId: service.id,
        professionalId: professional.id,
        date: new Date(Date.now() + 86400_000),
        startTime: "10:00",
        endTime: "10:30",
        status: "confirmed",
      },
    });
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { businessId: business.id } });
    await prisma.professional.deleteMany({ where: { businessId: business.id } });
    await prisma.service.deleteMany({ where: { businessId: business.id } });
    await prisma.client.deleteMany({ where: { id: client.id } });
    await prisma.phoneVerification.deleteMany({ where: { phone } });
    await prisma.business.deleteMany({ where: { id: business.id } });
  });

  it("bloqueia histórico, cancelamento e reagendamento sem verificação recente (403)", async () => {
    const history = await request(app).get("/api/public/appointment-history").query({ businessId: business.id, phone });
    expect(history.status).toBe(403);

    const list = await request(app).get("/api/public/appointments").query({ businessId: business.id, phone });
    expect(list.status).toBe(403);

    const cancel = await request(app).post(`/api/public/appointments/${appointment.id}/cancel`).send({ phone });
    expect(cancel.status).toBe(403);

    const ics = await request(app).get(`/api/appointments/${appointment.id}/ics`).query({ phone });
    expect(ics.status).toBe(403);
  });

  it("bloqueia exclusão LGPD sem verificação recente (403)", async () => {
    const res = await request(app).post("/api/public/clients/data-deletion").send({ businessId: business.id, phone });
    expect(res.status).toBe(403);
  });

  it("libera as ações depois do fluxo completo de OTP (start + confirm)", async () => {
    const start = await request(app).post("/api/public/verify/start").send({ businessId: business.id, phone });
    expect(start.status).toBe(200);

    const verification = await prisma.phoneVerification.findUnique({ where: { phone } });
    expect(verification).toBeTruthy();

    // Não temos como interceptar o código real (só existe hasheado) — lê o
    // código verdadeiro só é possível reimplementando o hash; em vez disso,
    // confirma com código errado primeiro (0 tentativas ainda gastas do
    // maxAttempts=5) e depois marca verifiedAt direto no banco, que é
    // exatamente o que confirmPhoneVerification faz internamente em caso de
    // sucesso — cobre o mesmo efeito observável (assertPhoneVerifiedRecently
    // olha só verifiedAt).
    const wrongConfirm = await request(app).post("/api/public/verify/confirm").send({ phone, code: "000000" });
    expect(wrongConfirm.status).toBe(400);

    await prisma.phoneVerification.update({ where: { phone }, data: { verifiedAt: new Date() } });

    const history = await request(app).get("/api/public/appointment-history").query({ businessId: business.id, phone });
    expect(history.status).toBe(200);

    const cancel = await request(app).post(`/api/public/appointments/${appointment.id}/cancel`).send({ phone });
    expect(cancel.status).toBe(200);
  });
});
