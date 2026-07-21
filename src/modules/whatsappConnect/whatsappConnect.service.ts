import crypto from "node:crypto";
import { env } from "@/config/env.js";
import { AppError } from "@/middleware/errorHandler.js";
import { TEMPLATE_DEFINITIONS, OTP_TEMPLATE_NAME } from "./templates.js";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export const whatsappConnectConfigured = !!(env.WHATSAPP_APP_ID && env.WHATSAPP_CONFIG_ID && env.WHATSAPP_APP_SECRET);

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

export async function registerPhoneNumber(phoneNumberId: string, accessToken: string, pin: string): Promise<void> {
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
