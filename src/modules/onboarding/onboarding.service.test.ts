import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma.js";
import { verifyPassword } from "@/lib/auth.js";

// Achado em produção (10/09): RESEND_API_KEY está configurada neste
// ambiente (mesmas credenciais de produção) — sem mockar isso,
// signupBarbershop chamava sendVerificationEmail de verdade a cada
// `vitest run` (endereço fictício @example.com, mas ainda uma chamada real
// à API do Resend — mesma classe de problema que alertPlatformOperator
// causou de verdade num teste irmão hoje, ver whatsappConnect.service.test.ts).
vi.mock("@/lib/email.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email.js")>();
  return { ...actual, sendVerificationEmail: vi.fn().mockResolvedValue(undefined) };
});

const { signupBarbershop, getOnboardingChecklist } = await import("./onboarding.service.js");

// Teste de integração: usa o banco real (sendVerificationEmail mockado acima).
describe("signupBarbershop", () => {
  const createdBarbershopIds: number[] = [];
  const createdUsernames: string[] = [];

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: createdUsernames } } });
    await prisma.service.deleteMany({ where: { businessId: { in: createdBarbershopIds } } });
    await prisma.professional.deleteMany({ where: { businessId: { in: createdBarbershopIds } } });
    await prisma.subscription.deleteMany({ where: { businessId: { in: createdBarbershopIds } } });
    await prisma.businessHours.deleteMany({ where: { businessId: { in: createdBarbershopIds } } });
    await prisma.business.deleteMany({ where: { id: { in: createdBarbershopIds } } });
  });

  function input(suffix: string) {
    return {
      shopName: `[teste] Barbearia Onboarding ${suffix}`,
      ownerName: "Dono de Teste",
      username: `teste-onboarding-${suffix}-${Date.now()}`,
      password: "senhaSegura123",
      phone: "5511999990000",
      email: `teste-onboarding-${suffix}-${Date.now()}@example.com`,
    };
  }

  it("cria barbearia, horário de funcionamento padrão, trial e usuário dono", async () => {
    const data = input("basico");
    const { barbershop, user } = await signupBarbershop(data);
    createdBarbershopIds.push(barbershop.id);
    createdUsernames.push(data.username);

    expect(barbershop.name).toBe(data.shopName);
    expect(user.role).toBe("owner");
    expect(user.businessId).toBe(barbershop.id);
    // A senha nunca é gravada em texto puro, só o hash — e o hash bate com
    // a senha original pelo mesmo verify usado no login.
    expect(verifyPassword(data.password, user.passwordHash)).toBe(true);

    const hours = await prisma.businessHours.findMany({ where: { businessId: barbershop.id }, orderBy: { weekday: "asc" } });
    expect(hours).toHaveLength(7);
    expect(hours[0]!.closed).toBe(true); // domingo (weekday 0) fechado por padrão
    expect(hours.filter((h) => !h.closed)).toHaveLength(6);
    expect(hours[1]!.opensAt).toBe("09:00");
    expect(hours[1]!.closesAt).toBe("19:00");

    const sub = await prisma.subscription.findUnique({ where: { businessId: barbershop.id } });
    expect(sub?.status).toBe("trialing");
    expect(sub?.plan).toBe("starter");
    expect(sub?.trialEndsAt).toBeTruthy();

    expect(user.emailVerificationToken).toBeTruthy();
    expect(user.emailVerifiedAt).toBeNull();
  });

  // Achado num QA (10/09): conta nova ficava sem profissional nem serviço —
  // sem os dois, não dá pra criar o primeiro agendamento sem antes navegar
  // até Configurações/Serviços. Signup agora já entrega os dois prontos.
  it("cria profissional padrão vinculado ao dono e serviço padrão", async () => {
    const data = input("padrao");
    const { barbershop, user } = await signupBarbershop(data);
    createdBarbershopIds.push(barbershop.id);
    createdUsernames.push(data.username);

    expect(user.professionalId).toBeTruthy();
    const professional = await prisma.professional.findUnique({ where: { id: user.professionalId! } });
    expect(professional?.businessId).toBe(barbershop.id);
    expect(professional?.name).toBe(data.ownerName);
    expect(professional?.active).toBe(true);

    const services = await prisma.service.findMany({ where: { businessId: barbershop.id } });
    expect(services).toHaveLength(1);
    expect(services[0]!.priceCents).toBeGreaterThan(0);
    expect(services[0]!.durationMin).toBeGreaterThan(0);
  });

  it("rejeita username já em uso", async () => {
    const data = input("dup-username");
    const { barbershop } = await signupBarbershop(data);
    createdBarbershopIds.push(barbershop.id);
    createdUsernames.push(data.username);

    const second = { ...input("dup-username-2"), username: data.username };
    await expect(signupBarbershop(second)).rejects.toThrow(/usuário já está em uso/);
  });

  it("rejeita e-mail já cadastrado", async () => {
    const data = input("dup-email");
    const { barbershop } = await signupBarbershop(data);
    createdBarbershopIds.push(barbershop.id);
    createdUsernames.push(data.username);

    const second = { ...input("dup-email-2"), email: data.email };
    await expect(signupBarbershop(second)).rejects.toThrow(/e-mail já está cadastrado/);
    createdUsernames.push(second.username); // não deveria ter sido criado, mas garante limpeza se o teste falhar
  });
});

// Achado num QA (10/09): mesmo com profissional/serviço prontos de cara
// (ver acima), o dono não tinha como saber o que ainda faltava pra receber
// cliente de verdade. Card na Visão Geral consulta esse checklist a cada
// carregamento e some sozinho quando `complete` vira true.
describe("getOnboardingChecklist", () => {
  const createdBarbershopIds: number[] = [];
  const createdUsernames: string[] = [];
  const createdClientPhones: string[] = [];

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { businessId: { in: createdBarbershopIds } } });
    await prisma.client.deleteMany({ where: { phone: { in: createdClientPhones } } });
    await prisma.user.deleteMany({ where: { username: { in: createdUsernames } } });
    await prisma.service.deleteMany({ where: { businessId: { in: createdBarbershopIds } } });
    await prisma.professional.deleteMany({ where: { businessId: { in: createdBarbershopIds } } });
    await prisma.subscription.deleteMany({ where: { businessId: { in: createdBarbershopIds } } });
    await prisma.businessHours.deleteMany({ where: { businessId: { in: createdBarbershopIds } } });
    await prisma.business.deleteMany({ where: { id: { in: createdBarbershopIds } } });
  });

  async function freshSignup(suffix: string) {
    const data = {
      shopName: `[teste] Checklist ${suffix}`,
      ownerName: "Dono de Teste",
      username: `teste-checklist-${suffix}-${Date.now()}`,
      password: "senhaSegura123",
      phone: "5511999990001",
      email: `teste-checklist-${suffix}-${Date.now()}@example.com`,
    };
    const { barbershop, user } = await signupBarbershop(data);
    createdBarbershopIds.push(barbershop.id);
    createdUsernames.push(data.username);
    return { barbershop, user };
  }

  it("conta nova: nenhum item concluído (e-mail ainda não confirmado)", async () => {
    const { barbershop, user } = await freshSignup("vazio");
    const result = await getOnboardingChecklist(barbershop.id, user.id);
    expect(result.complete).toBe(false);
    expect(Object.fromEntries(result.items.map((i) => [i.key, i.done]))).toEqual({
      whatsapp: false,
      services: false,
      hours: false,
      appointment: false,
      email: false,
    });
  });

  it("item de e-mail conta como feito quando a conta não tem e-mail (seed/demo)", async () => {
    const { barbershop, user } = await freshSignup("sememail");
    await prisma.user.update({ where: { id: user.id }, data: { email: null } });
    const result = await getOnboardingChecklist(barbershop.id, user.id);
    expect(result.items.find((i) => i.key === "email")?.done).toBe(true);
  });

  // Sugestão do usuário (10/09): horário errado faz a IA oferecer/aceitar
  // agendamento fora do funcionamento real da barbearia sem o dono nunca
  // ter conferido a tela — mesma lógica de "já mexeu no padrão do
  // cadastro" já usada pra serviços.
  it("item de horário conta como feito quando algum dia foi alterado do padrão do cadastro", async () => {
    const { barbershop, user } = await freshSignup("horario");
    const beforeChange = await getOnboardingChecklist(barbershop.id, user.id);
    expect(beforeChange.items.find((i) => i.key === "hours")?.done).toBe(false);

    const monday = await prisma.businessHours.findFirstOrThrow({ where: { businessId: barbershop.id, weekday: 1 } });
    await prisma.businessHours.update({ where: { id: monday.id }, data: { opensAt: "08:00" } });

    const afterChange = await getOnboardingChecklist(barbershop.id, user.id);
    expect(afterChange.items.find((i) => i.key === "hours")?.done).toBe(true);
  });

  it("fica completo quando WhatsApp conectado, serviço renomeado, horário ajustado, agendamento criado e e-mail confirmado", async () => {
    const { barbershop, user } = await freshSignup("completo");
    await prisma.business.update({ where: { id: barbershop.id }, data: { whatsappConnectionStatus: "connected" } });
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    const service = await prisma.service.findFirstOrThrow({ where: { businessId: barbershop.id } });
    await prisma.service.update({ where: { id: service.id }, data: { name: "Corte + Barba" } });
    const sunday = await prisma.businessHours.findFirstOrThrow({ where: { businessId: barbershop.id, weekday: 0 } });
    await prisma.businessHours.update({ where: { id: sunday.id }, data: { closed: false, opensAt: "10:00", closesAt: "14:00" } });

    const clientPhone = `5511999${Date.now().toString().slice(-6)}`;
    createdClientPhones.push(clientPhone);
    const client = await prisma.client.create({ data: { name: "[teste] Cliente Checklist", phone: clientPhone } });
    await prisma.appointment.create({
      data: {
        businessId: barbershop.id,
        professionalId: user.professionalId!,
        serviceId: service.id,
        clientId: client.id,
        date: new Date(),
        startTime: "10:00",
        endTime: "10:30",
      },
    });

    const result = await getOnboardingChecklist(barbershop.id, user.id);
    expect(result.complete).toBe(true);
    expect(result.items.every((i) => i.done)).toBe(true);
  });
});
