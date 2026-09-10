import { prisma } from "@/lib/prisma.js";
import { hashPassword } from "@/lib/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { generateVerificationToken, verificationTokenExpiry, sendVerificationEmail } from "@/lib/email.js";
import { env, vertical } from "@/config/env.js";

const TRIAL_DAYS = 7;
// Mesmo padrão usado no seed de demonstração: 09h-19h, fechado domingo
// (weekday 0). O dono ajusta depois pela aba de Configurações.
const DEFAULT_OPENS_AT = "09:00";
const DEFAULT_CLOSES_AT = "19:00";
// Achado num QA (10/09): conta nova ficava sem profissional nem serviço —
// sem os dois, não dá pra criar o primeiro agendamento sem antes descobrir
// sozinho os menus de Configurações/Serviços. Cria os dois já no cadastro,
// pré-preenchidos e óbvios de editar/renomear (nomes genéricos de propósito,
// funcionam pra qualquer vertical).
const DEFAULT_SERVICE_PRICE_CENTS = 3000;
const DEFAULT_SERVICE_DURATION_MIN = 30;
const DEFAULT_SERVICE_NAME = `${vertical.service.charAt(0).toUpperCase()}${vertical.service.slice(1)} padrão`;

export interface SignupInput {
  shopName: string;
  ownerName: string;
  username: string;
  password: string;
  phone: string;
  email: string;
}

export async function signupBarbershop(input: SignupInput) {
  const existingUsername = await prisma.user.findUnique({ where: { username: input.username } });
  if (existingUsername) throw new AppError("Esse nome de usuário já está em uso.", 409);
  const existingEmail = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingEmail) throw new AppError("Esse e-mail já está cadastrado.", 409);

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);
  const verificationToken = generateVerificationToken();
  const verificationExpiresAt = verificationTokenExpiry();

  const { barbershop, user } = await prisma.$transaction(async (tx) => {
    const barbershop = await tx.business.create({
      data: { name: input.shopName, phone: input.phone },
    });

    await tx.businessHours.createMany({
      data: Array.from({ length: 7 }, (_, weekday) => ({
        businessId: barbershop.id,
        weekday,
        opensAt: DEFAULT_OPENS_AT,
        closesAt: DEFAULT_CLOSES_AT,
        closed: weekday === 0,
      })),
    });

    // status "trialing" — sem cobrança implementada ainda (schema pronto
    // pra Stripe, ver campos stripeCustomerId/stripeSubscriptionId, mas
    // sem checkout/webhook por decisão consciente desta rodada).
    await tx.subscription.create({
      data: { businessId: barbershop.id, status: "trialing", plan: "starter", trialEndsAt },
    });

    let user = await tx.user.create({
      data: {
        businessId: barbershop.id,
        role: "owner",
        username: input.username,
        passwordHash: hashPassword(input.password),
        name: input.ownerName,
        email: input.email,
        emailVerificationToken: verificationToken,
        emailVerificationExpiresAt: verificationExpiresAt,
      },
    });

    // Profissional padrão vinculado ao próprio login do dono (mesmo caminho
    // de "Esse barbeiro sou eu" que já existe em Configurações) — assim a
    // conta nova já nasce com alguém pra atender, sem precisar navegar até
    // lá antes do primeiro agendamento. Segue ativo o modo barbeiro-único
    // (isSoloMode) até o dono cadastrar um segundo, como qualquer outra
    // barbearia com 1 profissional só.
    const professional = await tx.professional.create({
      data: { businessId: barbershop.id, name: input.ownerName },
    });
    user = await tx.user.update({ where: { id: user.id }, data: { professionalId: professional.id } });

    await tx.service.create({
      data: {
        businessId: barbershop.id,
        name: DEFAULT_SERVICE_NAME,
        priceCents: DEFAULT_SERVICE_PRICE_CENTS,
        durationMin: DEFAULT_SERVICE_DURATION_MIN,
      },
    });

    return { barbershop, user };
  });

  // Fora da transação: se o envio falhar, a conta já foi criada com
  // sucesso — a pessoa pode pedir reenvio depois logada (não faz sentido
  // desfazer o cadastro inteiro por causa de uma falha no provedor de e-mail).
  const verifyUrl = `${env.PUBLIC_BASE_URL || ""}/api/verify-email?token=${verificationToken}`;
  try {
    await sendVerificationEmail(input.email, input.ownerName, verifyUrl);
  } catch (err) {
    console.error("[EMAIL] Falha ao enviar confirmação de cadastro:", err);
  }

  return { barbershop, user };
}

export interface OnboardingChecklistItem {
  key: string;
  label: string;
  done: boolean;
}

// Achado num QA (10/09): mesmo depois de a conta nova nascer com
// profissional/serviço prontos (ver acima), o dono não tinha como saber o
// que já estava pronto pra receber cliente de verdade e o que ainda faltava
// — o tour guiado mostra a tela uma vez, mas não acompanha progresso.
// Consultado a cada carregamento da Visão Geral (sem gravar nada — deriva
// só do que já existe no banco); o painel esconde o card sozinho quando
// `complete` vira true.
export async function getOnboardingChecklist(businessId: number, userId: number): Promise<{ items: OnboardingChecklistItem[]; complete: boolean }> {
  const [user, services, appointmentsCount, business, hours] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } }),
    prisma.service.findMany({ where: { businessId }, select: { name: true } }),
    prisma.appointment.count({ where: { businessId } }),
    prisma.business.findUnique({ where: { id: businessId }, select: { whatsappConnectionStatus: true } }),
    prisma.businessHours.findMany({ where: { businessId }, select: { weekday: true, opensAt: true, closesAt: true, closed: true } }),
  ]);

  // "Cadastrou serviços de verdade" = tem mais de um, ou já mexeu no nome do
  // único serviço que veio pronto no cadastro (senão ficaria eternamente
  // "incompleto" pra quem só precisa de 1 serviço e já renomeou o padrão).
  const servicesCustomized = services.length > 1 || (services.length === 1 && services[0]!.name !== DEFAULT_SERVICE_NAME);

  // Mesma lógica de "já mexeu no padrão do cadastro" usada em serviços —
  // sem isso, uma barbearia que na verdade abre em outro horário (ou
  // domingo) ficaria com a IA oferecendo/aceitando horário errado no
  // WhatsApp sem o dono nunca ter conferido essa tela.
  const hoursCustomized = hours.some(
    (h) => h.opensAt !== DEFAULT_OPENS_AT || h.closesAt !== DEFAULT_CLOSES_AT || h.closed !== (h.weekday === 0)
  );

  // Ordem pensada pra seguir a sequência natural de quem tá começando
  // (sugestão do usuário, 10/09): confirmar a própria identidade primeiro,
  // preparar o que a IA vai oferecer (serviços e horário), só então
  // conectar o canal que depende disso, e o agendamento como validação
  // final de que tudo funciona ponta a ponta — nessa ordem, não a ordem
  // "técnica" antiga (WhatsApp primeiro).
  const items: OnboardingChecklistItem[] = [
    // Sem e-mail cadastrado (contas de seed/demo) não tem o que confirmar —
    // conta como feito pra não travar o checklist de quem nunca vai ter isso.
    { key: "email", label: "Confirme seu e-mail", done: !user?.email || !!user?.emailVerifiedAt },
    { key: "services", label: `Confira os ${vertical.servicePlural} oferecidos (preço e duração)`, done: servicesCustomized },
    { key: "hours", label: "Confirme seu horário de funcionamento", done: hoursCustomized },
    { key: "whatsapp", label: "Conecte seu WhatsApp pra IA atender seus clientes", done: business?.whatsappConnectionStatus !== "not_connected" },
    { key: "appointment", label: "Crie seu primeiro agendamento", done: appointmentsCount > 0 },
  ];

  return { items, complete: items.every((i) => i.done) };
}
