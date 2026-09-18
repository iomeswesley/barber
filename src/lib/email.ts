import crypto from "node:crypto";
import { Resend } from "resend";
import { env } from "@/config/env.js";
import { verificationEmail, passwordResetEmail, adminGeneratedPasswordEmail, type EmailContent } from "@/lib/emailCopy.js";

export const emailConfigured = !!env.RESEND_API_KEY;

const resend = emailConfigured ? new Resend(env.RESEND_API_KEY) : null;

// Idioma dos e-mails = idioma da região do deploy (donos e barbeiros são do
// mesmo país do deploy). Textos em src/lib/emailCopy.ts.
const EMAIL_LOCALE = env.APP_DEFAULT_LOCALE;

export function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function verificationTokenExpiry(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 24);
  return d;
}

// O SDK do Resend não lança exceção em erro da API — devolve { data, error }
// e a promise resolve normalmente. Sem checar isso à mão, uma falha de envio
// (ex: domínio não verificado) passaria silenciosamente, sem log nenhum e sem
// o try/catch de quem chama nunca disparar.
// Filtros de spam penalizam e-mail só-HTML sem alternativa em texto puro — por
// isso todo e-mail leva `text` além de `html` (parte da causa provável de cair
// em spam, junto do domínio remetente não bater com a marca do produto, ver
// EMAIL_FROM no .env).
async function deliver(to: string, content: EmailContent): Promise<void> {
  if (!resend) return;
  const { error } = await resend.emails.send({ from: env.EMAIL_FROM, to, subject: content.subject, html: content.html, text: content.text });
  if (error) throw new Error(`Resend: ${error.message}`);
}

export async function sendVerificationEmail(to: string, ownerName: string, verifyUrl: string): Promise<void> {
  if (!resend) {
    // Sem RESEND_API_KEY configurado — mesmo padrão do stub de WhatsApp:
    // não quebra o cadastro, só loga o link no console (útil em dev).
    console.log(`[EMAIL] (stub, RESEND_API_KEY não configurado) Confirmação para ${to}: ${verifyUrl}`);
    return;
  }
  await deliver(to, verificationEmail(EMAIL_LOCALE, ownerName, verifyUrl));
}

// Reset de senha usa o mesmo formato de token, mas expira bem mais rápido
// (1h) — é uma ação sensível (troca de senha), diferente da confirmação de
// cadastro que não tranca nada enquanto pendente.
export function passwordResetTokenExpiry(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 1);
  return d;
}

export async function sendPasswordResetEmail(to: string, name: string, username: string, resetUrl: string): Promise<void> {
  if (!resend) {
    console.log(`[EMAIL] (stub, RESEND_API_KEY não configurado) Redefinição de senha para ${to} (usuário: ${username}): ${resetUrl}`);
    return;
  }
  await deliver(to, passwordResetEmail(EMAIL_LOCALE, name, username, resetUrl));
}

// Usado pelo painel de super-admin: diferente do fluxo normal de "esqueci
// minha senha" (que manda um link), aqui o admin já gerou a senha nova e
// ela vai direto no corpo do e-mail — o usuário pode trocar depois se quiser.
export async function sendAdminGeneratedPasswordEmail(to: string, name: string, username: string, newPassword: string): Promise<void> {
  if (!resend) {
    console.log(`[EMAIL] (stub, RESEND_API_KEY não configurado) Nova senha gerada pelo admin para ${to} (usuário: ${username}): ${newPassword}`);
    return;
  }
  await deliver(to, adminGeneratedPasswordEmail(EMAIL_LOCALE, name, username, newPassword));
}
