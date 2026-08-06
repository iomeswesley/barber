import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma.js";
import { signupBarbershop } from "./onboarding.service.js";
import { verifyPassword } from "@/lib/auth.js";

// Teste de integração: usa o banco real. RESEND_API_KEY não está configurada
// neste ambiente, então sendVerificationEmail cai no stub (só loga, não
// manda e-mail de verdade) — seguro rodar sem risco de disparar nada.
describe("signupBarbershop", () => {
  const createdBarbershopIds: number[] = [];
  const createdUsernames: string[] = [];

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: createdUsernames } } });
    await prisma.subscription.deleteMany({ where: { barbershopId: { in: createdBarbershopIds } } });
    await prisma.businessHours.deleteMany({ where: { barbershopId: { in: createdBarbershopIds } } });
    await prisma.barbershop.deleteMany({ where: { id: { in: createdBarbershopIds } } });
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
    expect(user.barbershopId).toBe(barbershop.id);
    // A senha nunca é gravada em texto puro, só o hash — e o hash bate com
    // a senha original pelo mesmo verify usado no login.
    expect(verifyPassword(data.password, user.passwordHash)).toBe(true);

    const hours = await prisma.businessHours.findMany({ where: { barbershopId: barbershop.id }, orderBy: { weekday: "asc" } });
    expect(hours).toHaveLength(7);
    expect(hours[0]!.closed).toBe(true); // domingo (weekday 0) fechado por padrão
    expect(hours.filter((h) => !h.closed)).toHaveLength(6);
    expect(hours[1]!.opensAt).toBe("09:00");
    expect(hours[1]!.closesAt).toBe("19:00");

    const sub = await prisma.subscription.findUnique({ where: { barbershopId: barbershop.id } });
    expect(sub?.status).toBe("trialing");
    expect(sub?.plan).toBe("starter");
    expect(sub?.trialEndsAt).toBeTruthy();

    expect(user.emailVerificationToken).toBeTruthy();
    expect(user.emailVerifiedAt).toBeNull();
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
