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
  // O SDK do Resend não lança exceção em erro da API — devolve
  // { data, error } e a promise resolve normalmente. Sem checar isso à
  // mão, uma falha de envio (ex: domínio não verificado) passaria
  // silenciosamente, sem log nenhum e sem o try/catch de quem chama nunca
  // disparar.
  const { error } = await resend.emails.send({
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
  if (error) throw new Error(`Resend: ${error.message}`);
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
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: "Redefinir sua senha — Painel da Barbearia",
    html: `
      <p>Oi, ${name}!</p>
      <p>Pediram a redefinição da senha da sua conta. Seu usuário de login é <b>${username}</b>.</p>
      <p>Se foi você quem pediu, clique no link abaixo pra escolher uma senha nova:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>Esse link expira em 1 hora. Se não foi você, pode ignorar este e-mail.</p>
    `,
  });
  if (error) throw new Error(`Resend: ${error.message}`);
}

// Usado pelo painel de super-admin: diferente do fluxo normal de "esqueci
// minha senha" (que manda um link), aqui o admin já gerou a senha nova e
// ela vai direto no corpo do e-mail — o usuário pode trocar depois se quiser.
export async function sendAdminGeneratedPasswordEmail(to: string, name: string, username: string, newPassword: string): Promise<void> {
  if (!resend) {
    console.log(`[EMAIL] (stub, RESEND_API_KEY não configurado) Nova senha gerada pelo admin para ${to} (usuário: ${username}): ${newPassword}`);
    return;
  }
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: "Sua senha foi redefinida — Painel da Barbearia",
    html: `
      <p>Oi, ${name}!</p>
      <p>Um administrador da plataforma redefiniu a senha da sua conta. Seu usuário de login é <b>${username}</b> e sua nova senha de acesso é:</p>
      <p style="font-size: 18px; font-weight: 700; letter-spacing: 1px;">${newPassword}</p>
      <p>Recomendamos trocar essa senha assim que entrar, pela opção "Esqueci minha senha" na tela de login.</p>
    `,
  });
  if (error) throw new Error(`Resend: ${error.message}`);
}
