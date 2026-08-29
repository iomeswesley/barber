import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { prisma } from "@/lib/prisma.js";
import { hashPassword } from "@/lib/auth.js";
import type { AppointmentDTO } from "@/modules/appointments/appointments.types.js";

// Mocka a camada de rede com o Google (src/lib/googleCalendar.ts) — este
// ambiente de dev/teste não tem GOOGLE_CLIENT_ID/SECRET configurado (só em
// produção, ver CLAUDE.md), então googleCalendarConfigured seria false e
// nada do fluxo real seria exercitado. Fixando configured:true aqui e
// mockando as 5 funções que fazem fetch de verdade, cobre a lógica de
// negócio (mirror/remove, refresh de token expirado, isolamento entre
// tenants nas rotas) sem nenhuma chamada de rede.
const buildGoogleAuthUrlMock = vi.fn((redirectUri: string, state: string) => `https://accounts.google.com/mock?redirect_uri=${redirectUri}&state=${state}`);
const exchangeCodeForTokensMock = vi.fn();
const refreshAccessTokenMock = vi.fn();
const upsertCalendarEventMock = vi.fn();
const deleteCalendarEventMock = vi.fn();
vi.mock("@/lib/googleCalendar.js", () => ({
  googleCalendarConfigured: true,
  buildGoogleAuthUrl: (...args: [string, string]) => buildGoogleAuthUrlMock(...args),
  exchangeCodeForTokens: (...args: [string, string]) => exchangeCodeForTokensMock(...args),
  refreshAccessToken: (...args: [string]) => refreshAccessTokenMock(...args),
  upsertCalendarEvent: (...args: unknown[]) => upsertCalendarEventMock(...args),
  deleteCalendarEvent: (...args: unknown[]) => deleteCalendarEventMock(...args),
}));

const { createApp } = await import("@/app.js");
const {
  getConnectStatus,
  handleOAuthCallback,
  disconnectGoogleCalendar,
  mirrorAppointmentToGoogle,
  removeAppointmentFromGoogle,
} = await import("./googleCalendar.service.js");

function fakeAppointmentDTO(overrides: Partial<AppointmentDTO> & Pick<AppointmentDTO, "id" | "professionalId">): AppointmentDTO {
  return {
    businessId: 0,
    serviceId: 0,
    clientId: 0,
    date: "2026-09-01",
    startTime: "10:00",
    endTime: "10:30",
    status: "confirmed",
    reminderSentAt: null,
    reviewPromptedAt: null,
    createdAt: new Date(),
    barberName: "[teste] Profissional",
    serviceName: "[teste] Corte",
    durationMin: 30,
    priceCents: 5000,
    clientName: "[teste] Cliente",
    clientPhone: "5511999990000",
    barbershopName: "[teste] Barbearia",
    notes: null,
    confirmationToken: null,
    googleEventId: null,
    paymentMethod: null,
    couponId: null,
    clientPlanSubscriptionId: null,
    ...overrides,
  };
}

describe("Google Agenda (service + rotas)", () => {
  const PASSWORD = "senha-de-teste-google-calendar";
  let business: { id: number };
  let otherBusiness: { id: number };
  let username: string;
  let professional: { id: number };
  let otherProfessional: { id: number };
  let service: { id: number };
  let client: { id: number };

  beforeAll(async () => {
    business = await prisma.business.create({ data: { name: "[teste] Google Calendar HTTP" } });
    otherBusiness = await prisma.business.create({ data: { name: "[teste] Google Calendar Outra Barbearia" } });
    username = `teste-gcal-${business.id}`;
    await prisma.user.create({
      data: { businessId: business.id, role: "owner", username, passwordHash: hashPassword(PASSWORD), name: "[teste] Dono" },
    });
    professional = await prisma.professional.create({ data: { businessId: business.id, name: "[teste] Profissional" } });
    otherProfessional = await prisma.professional.create({ data: { businessId: otherBusiness.id, name: "[teste] Profissional Outro" } });
    service = await prisma.service.create({
      data: { businessId: business.id, name: "[teste] Corte", priceCents: 5000, durationMin: 30 },
    });
    client = await prisma.client.create({ data: { name: "[teste] Cliente GCal", phone: `teste-gcal-${Date.now()}` } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { businessId: business.id } });
    await prisma.appointment.deleteMany({ where: { businessId: business.id } });
    await prisma.client.deleteMany({ where: { id: client.id } });
    await prisma.service.deleteMany({ where: { businessId: business.id } });
    await prisma.professional.deleteMany({ where: { businessId: { in: [business.id, otherBusiness.id] } } });
    await prisma.user.deleteMany({ where: { businessId: business.id } });
    await prisma.business.deleteMany({ where: { id: { in: [business.id, otherBusiness.id] } } });
  });

  beforeEach(() => {
    exchangeCodeForTokensMock.mockReset();
    refreshAccessTokenMock.mockReset();
    upsertCalendarEventMock.mockReset();
    deleteCalendarEventMock.mockReset();
    buildGoogleAuthUrlMock.mockClear();
  });

  async function loginAgent() {
    const agent = request.agent(createApp());
    const login = await agent.post("/api/auth/login").send({ username, password: PASSWORD });
    expect(login.status).toBe(200);
    return agent;
  }

  describe("service", () => {
    it("getConnectStatus: false por padrão, true depois de handleOAuthCallback salvar a conexão", async () => {
      await prisma.professional.update({
        where: { id: professional.id },
        data: { googleCalendarTokenEnc: null, googleCalendarRefreshTokenEnc: null, googleCalendarId: null, googleCalendarConnectedAt: null },
      });
      expect((await getConnectStatus(professional.id)).connected).toBe(false);

      exchangeCodeForTokensMock.mockResolvedValue({ accessToken: "access-1", refreshToken: "refresh-1", expiresInSec: 3600 });
      await handleOAuthCallback(professional.id, "code-1", "https://app.teste/callback");

      const status = await getConnectStatus(professional.id);
      expect(status.connected).toBe(true);
      expect(status.connectedAt).toBeTruthy();
    });

    it("handleOAuthCallback: sem refresh_token na resposta do Google, lança erro em vez de salvar conexão quebrada", async () => {
      exchangeCodeForTokensMock.mockResolvedValue({ accessToken: "access-2", refreshToken: null, expiresInSec: 3600 });
      await expect(handleOAuthCallback(professional.id, "code-2", "https://app.teste/callback")).rejects.toThrow("refresh token");
    });

    it("mirrorAppointmentToGoogle: sem conexão salva, não chama a API do Google e retorna null", async () => {
      await disconnectGoogleCalendar(professional.id);
      const appointment = await prisma.appointment.create({
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
      const dto = fakeAppointmentDTO({ id: appointment.id, professionalId: professional.id });
      const result = await mirrorAppointmentToGoogle(dto);
      expect(result).toBeNull();
      expect(upsertCalendarEventMock).not.toHaveBeenCalled();
    });

    it("mirrorAppointmentToGoogle: com conexão salva, cria o evento e grava googleEventId no agendamento", async () => {
      exchangeCodeForTokensMock.mockResolvedValue({ accessToken: "access-3", refreshToken: "refresh-3", expiresInSec: 3600 });
      await handleOAuthCallback(professional.id, "code-3", "https://app.teste/callback");
      upsertCalendarEventMock.mockResolvedValue("google-event-abc");

      const appointment = await prisma.appointment.create({
        data: {
          businessId: business.id,
          clientId: client.id,
          serviceId: service.id,
          professionalId: professional.id,
          date: new Date(Date.now() + 86400_000),
          startTime: "14:00",
          endTime: "14:30",
          status: "confirmed",
        },
      });
      const dto = fakeAppointmentDTO({ id: appointment.id, professionalId: professional.id, serviceName: "[teste] Corte especial" });
      const result = await mirrorAppointmentToGoogle(dto);

      expect(result).toBe("google-event-abc");
      expect(upsertCalendarEventMock).toHaveBeenCalledTimes(1);
      const [, , eventInput] = upsertCalendarEventMock.mock.calls[0]!;
      expect(eventInput.summary).toContain("[teste] Corte especial");

      const updated = await prisma.appointment.findUnique({ where: { id: appointment.id } });
      expect(updated?.googleEventId).toBe("google-event-abc");
    });

    it("mirrorAppointmentToGoogle: token expirado (401) renova e tenta de novo uma vez", async () => {
      upsertCalendarEventMock.mockRejectedValueOnce(new Error("Falha ao salvar evento no Google Agenda (401): invalid_token"));
      upsertCalendarEventMock.mockResolvedValueOnce("google-event-refreshed");
      refreshAccessTokenMock.mockResolvedValue("access-renovado");

      const appointment = await prisma.appointment.create({
        data: {
          businessId: business.id,
          clientId: client.id,
          serviceId: service.id,
          professionalId: professional.id,
          date: new Date(Date.now() + 86400_000),
          startTime: "16:00",
          endTime: "16:30",
          status: "confirmed",
        },
      });
      const dto = fakeAppointmentDTO({ id: appointment.id, professionalId: professional.id });
      const result = await mirrorAppointmentToGoogle(dto);

      expect(result).toBe("google-event-refreshed");
      expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
      expect(upsertCalendarEventMock).toHaveBeenCalledTimes(2);
    });

    it("removeAppointmentFromGoogle: sem googleEventId, não chama a API", async () => {
      const dto = fakeAppointmentDTO({ id: 999999, professionalId: professional.id, googleEventId: null });
      await removeAppointmentFromGoogle(dto);
      expect(deleteCalendarEventMock).not.toHaveBeenCalled();
    });

    it("removeAppointmentFromGoogle: com googleEventId e conexão salva, chama a API do Google", async () => {
      deleteCalendarEventMock.mockResolvedValue(undefined);
      const dto = fakeAppointmentDTO({ id: 999999, professionalId: professional.id, googleEventId: "google-event-abc" });
      await removeAppointmentFromGoogle(dto);
      expect(deleteCalendarEventMock).toHaveBeenCalledTimes(1);
      expect(deleteCalendarEventMock.mock.calls[0]?.[2]).toBe("google-event-abc");
    });

    it("disconnectGoogleCalendar: limpa a conexão (getConnectStatus volta a false)", async () => {
      await disconnectGoogleCalendar(professional.id);
      expect((await getConnectStatus(professional.id)).connected).toBe(false);
    });
  });

  describe("rotas HTTP", () => {
    it("401 sem sessão em todas as rotas autenticadas", async () => {
      const app = createApp();
      const [config, status, connect, disconnect] = await Promise.all([
        request(app).get("/api/manage/google-calendar/config"),
        request(app).get("/api/manage/google-calendar/status").query({ professionalId: professional.id }),
        request(app).get("/api/manage/google-calendar/connect").query({ professionalId: professional.id }),
        request(app).post("/api/manage/google-calendar/disconnect").send({ professionalId: professional.id }),
      ]);
      expect(config.status).toBe(401);
      expect(status.status).toBe(401);
      expect(connect.status).toBe(401);
      expect(disconnect.status).toBe(401);
    });

    it("GET /config reflete googleCalendarConfigured", async () => {
      const res = await (await loginAgent()).get("/api/manage/google-calendar/config");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ configured: true });
    });

    it("GET /connect: 404 quando o professionalId pedido é de outra barbearia (isolamento entre tenants)", async () => {
      const res = await (await loginAgent()).get("/api/manage/google-calendar/connect").query({ professionalId: otherProfessional.id });
      expect(res.status).toBe(404);
    });

    it("GET /connect: 400 sem professionalId (dono precisa dizer de qual barbeiro)", async () => {
      const res = await (await loginAgent()).get("/api/manage/google-calendar/connect");
      expect(res.status).toBe(400);
    });

    it("GET /connect: devolve a URL de autorização do Google pro barbeiro certo", async () => {
      const res = await (await loginAgent()).get("/api/manage/google-calendar/connect").query({ professionalId: professional.id });
      expect(res.status).toBe(200);
      expect(res.body.url).toContain(String(professional.id));
      expect(buildGoogleAuthUrlMock).toHaveBeenCalledTimes(1);
    });

    it("GET /callback: sem code/state, redireciona com erro sem chamar a API do Google", async () => {
      const agent = await loginAgent();
      const res = await agent.get("/api/manage/google-calendar/callback");
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/admin.html?google_calendar=error");
      expect(exchangeCodeForTokensMock).not.toHaveBeenCalled();
    });

    it("GET /callback: professionalId de outra barbearia no state, redireciona com erro", async () => {
      const agent = await loginAgent();
      const res = await agent.get("/api/manage/google-calendar/callback").query({ code: "abc", state: String(otherProfessional.id) });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/admin.html?google_calendar=error");
      expect(exchangeCodeForTokensMock).not.toHaveBeenCalled();
    });

    it("GET /callback: sucesso salva a conexão e redireciona com ok", async () => {
      exchangeCodeForTokensMock.mockResolvedValue({ accessToken: "access-http", refreshToken: "refresh-http", expiresInSec: 3600 });
      const agent = await loginAgent();
      const res = await agent.get("/api/manage/google-calendar/callback").query({ code: "abc", state: String(professional.id) });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/admin.html?google_calendar=ok");

      const updated = await prisma.professional.findUnique({ where: { id: professional.id } });
      expect(updated?.googleCalendarConnectedAt).toBeTruthy();
    });

    it("POST /disconnect: limpa a conexão do barbeiro certo", async () => {
      const res = await (await loginAgent()).post("/api/manage/google-calendar/disconnect").send({ professionalId: professional.id });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });

      const updated = await prisma.professional.findUnique({ where: { id: professional.id } });
      expect(updated?.googleCalendarConnectedAt).toBeNull();
    });

    it("POST /disconnect: 404 quando o professionalId é de outra barbearia", async () => {
      const res = await (await loginAgent()).post("/api/manage/google-calendar/disconnect").send({ professionalId: otherProfessional.id });
      expect(res.status).toBe(404);
    });
  });
});
