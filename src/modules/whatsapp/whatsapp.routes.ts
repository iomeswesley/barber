import { Router } from "express";
import { env } from "@/config/env.js";
import { verifyWebhookSignature, sendWhatsappText, whatsappConfigured } from "@/lib/whatsapp.js";
import { getBarbershopByWhatsappPhoneNumberId } from "@/modules/barbershops/barbershops.repository.js";
import { sendMessage } from "@/modules/chat/chatEngine.js";

export const whatsappRouter = Router();

// Handshake de verificação do webhook (a Meta chama isso uma vez, ao salvar
// a URL de callback no painel de configuração da API).
whatsappRouter.get("/api/whatsapp/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && env.WHATSAPP_VERIFY_TOKEN && token === env.WHATSAPP_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

interface WhatsappWebhookPayload {
  entry?: {
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { profile?: { name?: string }; wa_id?: string }[];
        messages?: { from?: string; type?: string; text?: { body?: string } }[];
      };
    }[];
  }[];
}

whatsappRouter.post("/api/whatsapp/webhook", async (req, res) => {
  // Responde à Meta o quanto antes é a recomendação oficial, mas aqui
  // esperamos a resposta da IA terminar antes de responder 200 — em
  // ambiente serverless não há garantia de que trabalho assíncrono
  // continue rodando depois que a resposta HTTP é enviada. Isso pode fazer
  // a Meta reenviar o mesmo evento se a resposta demorar demais (retry
  // duplicado); aceitável por enquanto nesta fase de teste.
  try {
    if (!verifyWebhookSignature(req.rawBody!, req.headers["x-hub-signature-256"] as string | undefined)) {
      return res.sendStatus(401);
    }

    const payload = req.body as WhatsappWebhookPayload;
    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== "messages") continue;
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        const message = value?.messages?.[0];
        if (!phoneNumberId || !message) continue;

        const barbershop = await getBarbershopByWhatsappPhoneNumberId(phoneNumberId);
        if (!barbershop) {
          console.error(`[WHATSAPP] Nenhuma barbearia vinculada ao phone_number_id ${phoneNumberId}`);
          continue;
        }

        const from = message.from!;
        const pushName = value?.contacts?.[0]?.profile?.name;

        // Áudio, foto, figurinha etc. não vão pra IA (só entende texto) —
        // sem isso, o cliente mandaria algo e não receberia resposta
        // nenhuma, parecendo que o bot travou.
        if (message.type !== "text" || !message.text?.body) {
          await sendWhatsappText(
            phoneNumberId,
            from,
            "Por enquanto só consigo entender mensagens de texto 🙏 Pode escrever o que você precisa?"
          );
          continue;
        }

        const reply = await sendMessage(barbershop.id, from, message.text.body, from, pushName);
        await sendWhatsappText(phoneNumberId, from, reply);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("[WHATSAPP] Erro processando webhook:", err);
    // Ainda assim responde 200 pra Meta não ficar reenviando o mesmo evento
    // indefinidamente por um erro do nosso lado (ex: IA fora do ar).
    res.sendStatus(200);
  }
});

export { whatsappConfigured };
