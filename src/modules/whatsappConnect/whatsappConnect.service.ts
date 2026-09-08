import crypto from "node:crypto";
import { env } from "@/config/env.js";
import { AppError } from "@/middleware/errorHandler.js";
import { TEMPLATE_DEFINITIONS, OTP_TEMPLATE_NAME } from "./templates.js";
import { isWhatsappDisconnectionError } from "@/lib/whatsapp.js";
import { prisma } from "@/lib/prisma.js";
import { alertPlatformOperator } from "@/lib/alerts.js";
import { captureError } from "@/lib/errorReporting.js";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export const whatsappConnectConfigured = !!(env.WHATSAPP_APP_ID && env.WHATSAPP_CONFIG_ID && env.WHATSAPP_APP_SECRET);

// Chamar no catch de qualquer envio real pro WhatsApp (webhook, lembretes,
// lista de espera, mensagem manual do painel...) — se o erro indicar que a
// conexão caiu de verdade (ver isWhatsappDisconnectionError), marca a
// barbearia como "disconnected" no banco, pra o painel parar de mostrar
// "conectado" quando não está mais. Achado em produção (2026-09-07): antes
// disso, uma queda real só era percebida se alguém checasse manualmente
// direto na Meta — nada no sistema detectava sozinho. Best-effort: nunca
// lança, só loga se a própria atualização falhar — não deve derrubar o
// fluxo de envio que já falhou por outro motivo.
export async function markWhatsappDisconnectedIfNeeded(businessId: number, err: unknown): Promise<void> {
  if (!isWhatsappDisconnectionError(err)) return;
  try {
    // updateMany com a condição extra "ainda não estava disconnected" —
    // devolve count=0 se já estava marcado (ex: 5ª mensagem falhando desde
    // que a conexão caiu), pra só alertar na TRANSIÇÃO, não em cada falha
    // repetida enquanto ninguém reconecta.
    const { count } = await prisma.business.updateMany({
      where: { id: businessId, whatsappConnectionStatus: { not: "disconnected" } },
      data: { whatsappConnectionStatus: "disconnected" },
    });
    if (count > 0) {
      const business = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true, whatsappDisplayPhone: true } });
      await alertPlatformOperator(
        "WhatsApp desconectado",
        `A barbearia "${business?.name ?? businessId}" (número ${business?.whatsappDisplayPhone ?? "?"}) teve a conexão de WhatsApp derrubada de verdade (token/WABA perdeu acesso na Meta). O atendimento automático parou até alguém reconectar pelo painel.`
      );
    }
  } catch (dbErr) {
    console.error(`[WHATSAPP CONNECT] Falha ao marcar barbearia ${businessId} como desconectada:`, (dbErr as Error).message);
    captureError(dbErr);
  }
}

function requireConfigured() {
  if (!whatsappConnectConfigured) {
    throw new AppError("Conexão self-service de WhatsApp ainda não configurada no servidor.", 503);
  }
}

// Troca o "code" devolvido pelo popup de Embedded Signup por um token de
// acesso da conta do cliente — chamada servidor a servidor, nunca exposta ao
// frontend (o code sozinho não permite mandar mensagem nenhuma).
export async function exchangeCodeForToken(code: string): Promise<string> {
  requireConfigured();
  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set("client_id", env.WHATSAPP_APP_ID!);
  url.searchParams.set("client_secret", env.WHATSAPP_APP_SECRET!);
  url.searchParams.set("code", code);

  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError(`Falha ao trocar código pelo token de acesso da Meta (${res.status}): ${body}`, 502);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new AppError("Resposta da Meta não trouxe access_token.", 502);
  return data.access_token;
}

// PIN de verificação em 2 passos exigido pelo registro do número — gerado
// por nós (o dono nunca precisa ver/digitar isso) e guardado criptografado
// pra eventual re-registro futuro (ex: número desconectado e reconectado).
export function generateRegistrationPin(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

// Redefine o PIN de verificação em 2 passos do número direto no nó
// {phone_number_id} (endpoint diferente do /register abaixo) — não exige o
// PIN antigo, só um token válido. Chamamos isso sempre antes do /register
// pra garantir que o PIN que vamos usar ali é sempre o que a gente acabou de
// gerar, mesmo se o número já tiver 2FA de uma conexão anterior (senão o
// /register rejeita com "(#133005) Two step verification PIN Mismatch" — foi
// exatamente o que aconteceu ao reconectar um número já registrado antes).
async function setTwoStepPin(phoneNumberId: string, accessToken: string, pin: string): Promise<void> {
  const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError(`Falha ao definir o PIN de verificação do WhatsApp (${res.status}): ${body}`, 502);
  }
}

// Registra o número na Cloud API — só chamado no fluxo normal (não
// Coexistence). Num número em modo Coexistence ele já está registrado pelo
// próprio WhatsApp Business App; chamar /register de novo é desnecessário e
// arriscado (poderia derrubar a sessão do app no celular do dono) — ver o
// branch condicional em whatsappConnect.routes.ts.
export async function registerPhoneNumber(phoneNumberId: string, accessToken: string, pin: string): Promise<void> {
  await setTwoStepPin(phoneNumberId, accessToken, pin);
  const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", pin }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError(`Falha ao registrar o número de WhatsApp (${res.status}): ${body}`, 502);
  }
}

// Assina o app da plataforma nos webhooks dessa WABA — sem isso, mensagens
// recebidas nesse número não chegam no nosso /api/whatsapp/webhook.
export async function subscribeAppToWaba(wabaId: string, accessToken: string): Promise<void> {
  const res = await fetch(`${GRAPH_BASE}/${wabaId}/subscribed_apps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError(`Falha ao assinar o app nos webhooks da WABA (${res.status}): ${body}`, 502);
  }
}

export async function getDisplayPhoneNumber(phoneNumberId: string, accessToken: string): Promise<string | null> {
  const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}?fields=display_phone_number`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { display_phone_number?: string };
  return data.display_phone_number ?? null;
}

// Recria na WABA nova os templates já usados pela plataforma (ver
// templates.ts) — melhor esforço: erro num template (ex: nome já existe)
// não derruba os outros, só fica registrado no log pro dono revisar depois
// se algum recurso (lembrete/reagendamento/reconquista) não funcionar.
export async function createTemplates(wabaId: string, accessToken: string): Promise<{ name: string; ok: boolean; error?: string }[]> {
  const results: { name: string; ok: boolean; error?: string }[] = [];

  for (const tpl of TEMPLATE_DEFINITIONS) {
    try {
      const res = await fetch(`${GRAPH_BASE}/${wabaId}/message_templates`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tpl.name,
          language: "pt_BR",
          category: tpl.category,
          components: [{ type: "BODY", text: tpl.bodyText }],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        results.push({ name: tpl.name, ok: false, error: body });
        continue;
      }
      results.push({ name: tpl.name, ok: true });
    } catch (err) {
      results.push({ name: tpl.name, ok: false, error: (err as Error).message });
    }
  }

  // Template de Authentication tem estrutura fixa exigida pela Meta (botão
  // OTP obrigatório, sem componente de corpo com texto livre).
  try {
    const res = await fetch(`${GRAPH_BASE}/${wabaId}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: OTP_TEMPLATE_NAME,
        language: "pt_BR",
        category: "AUTHENTICATION",
        components: [
          { type: "BODY", add_security_recommendation: true },
          { type: "FOOTER", code_expiration_minutes: 10 },
          {
            type: "BUTTONS",
            buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copiar código" }],
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      results.push({ name: OTP_TEMPLATE_NAME, ok: false, error: body });
    } else {
      results.push({ name: OTP_TEMPLATE_NAME, ok: true });
    }
  } catch (err) {
    results.push({ name: OTP_TEMPLATE_NAME, ok: false, error: (err as Error).message });
  }

  return results;
}
