import { prisma } from "@/lib/prisma.js";

// Movido de clientPlans.repository.ts (2026-08-15): o modelo PhoneVerification
// é genérico (chave só o telefone, sem FK pra ClientPlan) e passou a ser usado
// também pelas rotas públicas de agendamento (/api/public/appointments*) e
// exclusão LGPD (/api/public/clients/data-deletion), não só pelo checkout de
// planos — por isso mora em `clients`, o módulo comum a todos esses fluxos.

export function upsertPhoneVerification(phone: string, codeHash: string, expiresAt: Date) {
  return prisma.phoneVerification.upsert({
    where: { phone },
    update: { codeHash, expiresAt, attempts: 0, verifiedAt: null },
    create: { phone, codeHash, expiresAt, attempts: 0 },
  });
}

export function getPhoneVerification(phone: string) {
  return prisma.phoneVerification.findUnique({ where: { phone } });
}

export function incrementPhoneVerificationAttempts(phone: string) {
  return prisma.phoneVerification.update({ where: { phone }, data: { attempts: { increment: 1 } } });
}

export function markPhoneVerified(phone: string) {
  return prisma.phoneVerification.update({ where: { phone }, data: { verifiedAt: new Date() } });
}

// Confia no canal pra provar que o telefone é do próprio cliente — usado só
// pelo fluxo de chat do WhatsApp, onde o número já vem autenticado pela
// própria Meta (é o remetente real da mensagem). Diferente das rotas
// públicas (minha-conta.html, excluir-dados.html), onde qualquer visitante
// pode digitar qualquer telefone e por isso passa pelo código OTP de verdade
// (upsertPhoneVerification + confirmPhoneVerification). codeHash/expiresAt
// aqui são só placeholders pra satisfazer o schema — assertPhoneVerifiedRecently
// só olha verifiedAt, nunca essas duas colunas.
export function upsertPhoneVerifiedTrusted(phone: string) {
  const now = new Date();
  return prisma.phoneVerification.upsert({
    where: { phone },
    update: { verifiedAt: now },
    create: { phone, codeHash: "trusted-channel", expiresAt: now, attempts: 0, verifiedAt: now },
  });
}
