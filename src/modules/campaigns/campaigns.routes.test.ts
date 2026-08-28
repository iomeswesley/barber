import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { prisma } from "@/lib/prisma.js";
import { hashPassword } from "@/lib/auth.js";

// Mocka o envio real de WhatsApp (chamaria a Cloud API de verdade) —
// createAndDispatchCampaign continua real, batendo no banco real, mesmo
// padrão dos outros testes HTTP do projeto (ver whatsapp.routes.test.ts).
const sendComeBackMessageMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/jobs/reminders.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/jobs/reminders.js")>();
  return { ...actual, sendComeBackMessage: (...args: unknown[]) => sendComeBackMessageMock(...(args as Parameters<typeof actual.sendComeBackMessage>)) };
});

const { createApp } = await import("@/app.js");

// Cobre createAndDispatchCampaign fim a fim (POST /api/manage/campaigns):
// alvo = cliente com última visita >= inactiveDays E não campanhado nos
// últimos 90 dias; dentro dos alvos, só quem tem marketingOptIn recebe de
// fato (mensagem de reconquista é categoria marketing na Meta). Semeia
// agendamentos concluídos no passado pra cada cenário em vez de mockar
// getClientStats — cobre a integração real com o cálculo de "última visita".
describe("rotas de /api/manage/campaigns", () => {
  const app = createApp();
  const PASSWORD = "senha-de-teste-campaigns";
  let business: { id: number };
  let username: string;
  let service: { id: number };
  let professional: { id: number };

  // A: elegível e com opt-in -> deve receber. B: elegível mas sem opt-in ->
  // conta em skippedNoOptIn. C: visitou recentemente (dentro do threshold)
  // -> nem entra nos alvos. D: elegível por data, mas já foi campanhado nos
  // últimos 90 dias -> conta em skippedRecentlyCampaigned, não recebe.
  let clientA: { id: number; phone: string };
  let clientB: { id: number; phone: string };
  let clientC: { id: number; phone: string };
  let clientD: { id: number; phone: string };

  function daysAgo(n: number): Date {
    return new Date(Date.now() - n * 86400_000);
  }

  async function createCompletedAppointment(clientId: number, date: Date) {
    await prisma.appointment.create({
      data: {
        businessId: business.id,
        clientId,
        serviceId: service.id,
        professionalId: professional.id,
        date,
        startTime: "10:00",
        endTime: "10:30",
        status: "confirmed",
      },
    });
  }

  beforeAll(async () => {
    business = await prisma.business.create({ data: { name: "[teste] Campaigns HTTP" } });
    username = `teste-campaigns-${business.id}`;
    await prisma.user.create({
      data: { businessId: business.id, role: "owner", username, passwordHash: hashPassword(PASSWORD), name: "[teste] Dono" },
    });
    service = await prisma.service.create({
      data: { businessId: business.id, name: "[teste] Corte", priceCents: 5000, durationMin: 30 },
    });
    professional = await prisma.professional.create({ data: { businessId: business.id, name: "[teste] Profissional" } });

    const suffix = Date.now().toString().slice(-8);
    clientA = await prisma.client.create({ data: { name: "[teste] Cliente A", phone: `5511900${suffix}`, marketingOptIn: true } });
    clientB = await prisma.client.create({ data: { name: "[teste] Cliente B", phone: `5511901${suffix}`, marketingOptIn: false } });
    clientC = await prisma.client.create({ data: { name: "[teste] Cliente C", phone: `5511902${suffix}`, marketingOptIn: true } });
    clientD = await prisma.client.create({ data: { name: "[teste] Cliente D", phone: `5511903${suffix}`, marketingOptIn: true } });

    await createCompletedAppointment(clientA.id, daysAgo(100));
    await createCompletedAppointment(clientB.id, daysAgo(100));
    await createCompletedAppointment(clientC.id, daysAgo(5));
    await createCompletedAppointment(clientD.id, daysAgo(100));

    // D já recebeu uma campanha (de outra campanha qualquer) há 10 dias —
    // dentro da janela de 90 dias de reenvio.
    const oldCampaign = await prisma.campaign.create({
      data: { businessId: business.id, name: "[teste] Campanha antiga", messageTemplate: "Oi", inactiveDaysThreshold: 30 },
    });
    await prisma.campaignSend.create({
      data: { campaignId: oldCampaign.id, clientId: clientD.id, businessId: business.id, sentAt: daysAgo(10) },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { businessId: business.id } });
    await prisma.campaignSend.deleteMany({ where: { businessId: business.id } });
    await prisma.campaign.deleteMany({ where: { businessId: business.id } });
    await prisma.appointment.deleteMany({ where: { businessId: business.id } });
    await prisma.client.deleteMany({ where: { id: { in: [clientA.id, clientB.id, clientC.id, clientD.id] } } });
    await prisma.professional.deleteMany({ where: { businessId: business.id } });
    await prisma.service.deleteMany({ where: { businessId: business.id } });
    await prisma.user.deleteMany({ where: { businessId: business.id } });
    await prisma.business.deleteMany({ where: { id: business.id } });
  });

  async function loginAgent() {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ username, password: PASSWORD });
    expect(login.status).toBe(200);
    return agent;
  }

  it("401 sem sessão", async () => {
    const [list, create] = await Promise.all([
      request(app).get("/api/manage/campaigns"),
      request(app).post("/api/manage/campaigns").send({ name: "x", message: "y", inactiveDays: 30 }),
    ]);
    expect(list.status).toBe(401);
    expect(create.status).toBe(401);
  });

  it("400 quando falta nome, mensagem ou dias de inatividade inválidos", async () => {
    const agent = await loginAgent();
    const noName = await agent.post("/api/manage/campaigns").send({ message: "Oi", inactiveDays: 30 });
    expect(noName.status).toBe(400);

    const noMessage = await agent.post("/api/manage/campaigns").send({ name: "Campanha", inactiveDays: 30 });
    expect(noMessage.status).toBe(400);

    const badDays = await agent.post("/api/manage/campaigns").send({ name: "Campanha", message: "Oi", inactiveDays: 0 });
    expect(badDays.status).toBe(400);
  });

  it("cria e dispara: só quem está inativo há tempo suficiente E deu opt-in recebe, com os contadores certos", async () => {
    sendComeBackMessageMock.mockClear();
    const agent = await loginAgent();

    const res = await agent.post("/api/manage/campaigns").send({
      name: "[teste] Reativação",
      message: "Sentimos sua falta!",
      inactiveDays: 30,
    });

    expect(res.status).toBe(201);
    expect(res.body.targeted).toBe(2); // A e B (>=30 dias, não recém-campanhados) — D fica de fora do alvo (recentlyCampaigned)
    expect(res.body.sent).toBe(1); // só A tem opt-in
    expect(res.body.skipped_no_opt_in).toBe(1); // B
    expect(res.body.skipped_recently_campaigned).toBe(1); // D

    expect(sendComeBackMessageMock).toHaveBeenCalledTimes(1);
    expect(sendComeBackMessageMock.mock.calls[0]?.[1]).toBe(clientA.phone);

    const campaign = await prisma.campaign.findUnique({ where: { id: res.body.campaign_id } });
    expect(campaign?.sentCount).toBe(1);

    const sendRow = await prisma.campaignSend.findFirst({ where: { campaignId: res.body.campaign_id, clientId: clientA.id } });
    expect(sendRow).toBeTruthy();

    const sendRowB = await prisma.campaignSend.findFirst({ where: { campaignId: res.body.campaign_id, clientId: clientB.id } });
    expect(sendRowB).toBeNull();
  });

  it("GET lista as campanhas criadas, mais recente primeiro", async () => {
    const res = await (await loginAgent()).get("/api/manage/campaigns");
    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual(
      expect.objectContaining({ name: "[teste] Reativação", inactive_days_threshold: 30, sent_count: 1 })
    );
  });
});
