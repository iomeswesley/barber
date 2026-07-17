import crypto from "node:crypto";
import { env } from "@/config/env.js";

export const whatsappConfigured = !!env.WHATSAPP_ACCESS_TOKEN;

const GRAPH_API_VERSION = "v21.0";

// Envia uma mensagem de texto via WhatsApp Cloud API. `to` é o wa_id do
// destinatário (telefone completo com DDI, sem "+", ex: "5511999998888").
export async function sendWhatsappText(phoneNumberId: string, to: string, text: string): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
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

// Verifica a assinatura HMAC-SHA256 que a Meta envia no header
// "X-Hub-Signature-256", garantindo que a requisição do webhook realmente
// veio da Meta (usando o App Secret) e não de terceiros.
export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!env.WHATSAPP_APP_SECRET) return true; // sem app secret configurado, não valida (só pra facilitar dev inicial)
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", env.WHATSAPP_APP_SECRET).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}
