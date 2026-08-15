import crypto from "node:crypto";
import { AppError } from "@/middleware/errorHandler.js";
import { hashPassword, verifyPassword } from "@/lib/auth.js";
import { sendWhatsappAuthTemplate, resolveBarbershopAccessToken } from "@/lib/whatsapp.js";
import { getBarbershop } from "@/modules/businesses/businesses.repository.js";
import {
  upsertPhoneVerification,
  getPhoneVerification,
  incrementPhoneVerificationAttempts,
  markPhoneVerified,
  upsertPhoneVerifiedTrusted,
} from "./phoneVerification.repository.js";

// Movido de clientPlans.service.ts (2026-08-15) — verificação de telefone via
// código OTP no WhatsApp, hoje compartilhada por 3 fluxos públicos:
// checkout de plano de cliente, autoatendimento de agendamento
// (ver/cancelar/reagendar) e exclusão de dados (LGPD). Todos confiavam só no
// telefone informado como identidade até então; ver [[project_saas_rewrite]].

const OTP_EXPIRY_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_VERIFIED_WINDOW_MS = 15 * 60_000;

export async function startPhoneVerification(businessId: number, phone: string): Promise<void> {
  const shop = await getBarbershop(businessId);
  if (!shop?.whatsappPhoneNumberId) {
    throw new AppError("Verificação indisponível pra essa barbearia.", 400);
  }
  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = hashPassword(code);
  await upsertPhoneVerification(phone, codeHash, new Date(Date.now() + OTP_EXPIRY_MS));
  const accessToken = resolveBarbershopAccessToken(shop);
  await sendWhatsappAuthTemplate(shop.whatsappPhoneNumberId, phone, "client_plan_otp", code, "pt_BR", accessToken);
}

export async function confirmPhoneVerification(phone: string, code: string): Promise<void> {
  const verification = await getPhoneVerification(phone);
  if (!verification) throw new AppError("Nenhum código pendente pra esse telefone. Peça um novo código.", 400);
  if (verification.expiresAt < new Date()) throw new AppError("Código expirado. Peça um novo código.", 400);
  if (verification.attempts >= OTP_MAX_ATTEMPTS) throw new AppError("Muitas tentativas. Peça um novo código.", 400);
  if (!verifyPassword(code, verification.codeHash)) {
    await incrementPhoneVerificationAttempts(phone);
    throw new AppError("Código incorreto.", 400);
  }
  await markPhoneVerified(phone);
}

// Ver comentário de upsertPhoneVerifiedTrusted — só pro bot de chat, nunca
// pras rotas públicas (minha-conta.html, excluir-dados.html etc.).
export async function verifyPhoneViaTrustedChannel(phone: string): Promise<void> {
  await upsertPhoneVerifiedTrusted(phone);
}

export async function assertPhoneVerifiedRecently(phone: string): Promise<void> {
  const verification = await getPhoneVerification(phone);
  if (!verification?.verifiedAt || Date.now() - verification.verifiedAt.getTime() > OTP_VERIFIED_WINDOW_MS) {
    throw new AppError("Verifique seu telefone antes de continuar.", 403);
  }
}
