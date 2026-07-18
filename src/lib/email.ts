import crypto from "node:crypto";
import { Resend } from "resend";
import { env } from "@/config/env.js";

export const emailConfigured = !!env.RESEND_API_KEY;

const resend = emailConfigured ? new Resend(env.RESEND_API_KEY) : null;

export function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function verificationTokenExpiry(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 24);
  return d;
}

export async function sendVerificationEmail(to: string, ownerName: string, verifyUrl: string): Promise<void> {
  if (!resend) {
    // Sem RESEND_API_KEY configurado — mesmo padrão do stub de WhatsApp:
    // não quebra o cadastro, só loga o link no console (útil em dev).
    console.log(`[EMAIL] (stub, RESEND_API_KEY não configurado) Confirmação para ${to}: ${verifyUrl}`);
    return;
  }
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: "Confirme seu e-mail — Painel da Barbearia",
    html: `
      <p>Oi, ${ownerName}!</p>
      <p>Confirme seu e-mail pra ativar sua conta no painel da barbearia:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>Esse link expira em 24 horas.</p>
    `,
  });
}
