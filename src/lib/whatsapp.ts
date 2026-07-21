import crypto from "node:crypto";
import { env, isProduction } from "@/config/env.js";
import { decryptSecret } from "@/lib/crypto.js";

export const whatsappConfigured = !!env.WHATSAPP_ACCESS_TOKEN;

// Descriptografa o token da própria barbearia (WhatsApp Connect) quando ela
// já conectou o número; se não tiver conectado (ou a descriptografia falhar
// por qualquer motivo) volta undefined, e as funções de envio caem pro token
// global da plataforma automaticamente.
export function resolveBarbershopAccessToken(
  barbershop: { whatsappAccessTokenEnc?: string | null } | null | undefined
): string | undefined {
  if (!barbershop?.whatsappAccessTokenEnc) return undefined;
  try {
    return decryptSecret(barbershop.whatsappAccessTokenEnc);
  } catch (err) {
    console.error("[WHATSAPP] Falha ao descriptografar token da barbearia, caindo pro token global:", (err as Error).message);
    return undefined;
  }
}

const GRAPH_API_VERSION = "v21.0";

// Envia uma mensagem de texto via WhatsApp Cloud API. `to` é o wa_id do
// destinatário (telefone completo com DDI, sem "+", ex: "5511999998888").
// `accessToken` é o token da própria barbearia (WhatsApp Connect); quando
// omitido cai no token global da plataforma — retrocompatível com as
// barbearias que ainda não conectaram o próprio número.
export async function sendWhatsappText(phoneNumberId: string, to: string, text: string, accessToken?: string): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken || env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Falha ao enviar mensagem WhatsApp (${res.status}): ${body}`);
  }
}

// Envia uma mensagem via Message Template aprovado — necessário pra
// mensagens iniciadas pela barbearia (não em resposta direta a uma
// mensagem do cliente) fora da janela de 24h da última interação, quando
// texto livre é rejeitado pela Cloud API. `params` preenche os
// placeholders {{1}}, {{2}}... do corpo do template, na ordem.
export async function sendWhatsappTemplate(
  phoneNumberId: string,
  to: string,
  templateName: string,
  params: string[],
  languageCode = "pt_BR",
  accessToken?: string
): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken || env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }],
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Falha ao enviar template WhatsApp "${templateName}" (${res.status}): ${body}`);
  }
}

// Envia um template de categoria Authentication (ex: código de verificação
// de telefone antes do checkout de plano) — a Meta exige exatamente um botão
// do tipo OTP nesses templates, então o corpo E o botão precisam receber o
// código, em componentes separados (diferente de sendWhatsappTemplate).
export async function sendWhatsappAuthTemplate(
  phoneNumberId: string,
  to: string,
  templateName: string,
  code: string,
  languageCode = "pt_BR",
  accessToken?: string
): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken || env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [
          { type: "body", parameters: [{ type: "text", text: code }] },
          {
            type: "button",
            sub_type: "copy_code",
            index: "0",
            parameters: [{ type: "coupon_code", coupon_code: code }],
          },
        ],
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Falha ao enviar template de autenticação WhatsApp "${templateName}" (${res.status}): ${body}`);
  }
}

// Verifica a assinatura HMAC-SHA256 que a Meta envia no header
// "X-Hub-Signature-256", garantindo que a requisição do webhook realmente
// veio da Meta (usando o App Secret) e não de terceiros.
export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!env.WHATSAPP_APP_SECRET) {
    // Sem app secret configurado não dá pra validar assinatura nenhuma —
    // em produção isso significa que qualquer um poderia forjar eventos do
    // webhook, então falha fechado. Só libera sem checagem em dev/test pra
    // não travar quem ainda não configurou a Meta localmente.
    return !isProduction;
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", env.WHATSAPP_APP_SECRET).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}
