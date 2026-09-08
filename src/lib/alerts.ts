// Alerta operacional pro operador da plataforma (não pro dono da barbearia)
// — achado em produção (2026-09-07): 3 falhas reais essa semana (créditos
// da Anthropic zerados, WhatsApp desconectado de verdade) só foram
// percebidas porque alguém notou o sintoma e perguntou. Nada no sistema
// avisava sozinho. Reusa o Resend já configurado pra e-mail transacional
// (ver src/lib/email.ts) — se PLATFORM_ALERT_EMAIL não estiver configurado,
// só loga (mesmo padrão defensivo dos outros stubs do projeto: nunca quebra
// o fluxo principal por falta de configuração opcional).
import { Resend } from "resend";
import { env } from "@/config/env.js";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

// Nunca lança — um alerta que falha não pode derrubar o fluxo que estava
// tentando alertar sobre outra coisa (ver lição do fire-and-forget do
// Google Agenda: aqui SEMPRE aguardamos a chamada terminar, só não
// propagamos erro dela).
export async function alertPlatformOperator(subject: string, message: string): Promise<void> {
  if (!resend || !env.PLATFORM_ALERT_EMAIL) {
    console.error(`[ALERTA] (PLATFORM_ALERT_EMAIL não configurado, só logando) ${subject}: ${message}`);
    return;
  }
  try {
    const { error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: env.PLATFORM_ALERT_EMAIL,
      subject: `[Alerta] ${subject}`,
      html: `<p>${message.replace(/\n/g, "<br>")}</p>`,
    });
    if (error) console.error(`[ALERTA] Falha ao mandar e-mail de alerta ("${subject}"):`, error);
  } catch (err) {
    console.error(`[ALERTA] Falha ao mandar e-mail de alerta ("${subject}"):`, (err as Error).message);
  }
}
