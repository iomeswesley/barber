import { Router } from "express";
import { Prisma } from "@prisma/client";
import { env } from "@/config/env.js";
import { prisma } from "@/lib/prisma.js";
import { verifyWebhookSignature, sendWhatsappText, whatsappConfigured } from "@/lib/whatsapp.js";
import { getBarbershopByWhatsappPhoneNumberId } from "@/modules/barbershops/barbershops.repository.js";
import { sendMessage } from "@/modules/chat/chatEngine.js";

// Registra o wamid como processado; retorna false se já tinha sido
// registrado antes (reenvio duplicado da Meta), pra quem chamar pular o
// processamento. O insert em si é que resolve a corrida entre requisições
// concorrentes — a constraint UNIQUE da tabela rejeita a segunda tentativa.
async function markMessageAsProcessed(wamid: string): Promise<boolean> {
  try {
    await prisma.processedWhatsappMessage.create({ data: { id: wamid } });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
}

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
        messages?: { id?: string; from?: string; type?: string; text?: { body?: string } }[];
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
  // duplicado); markMessageAsProcessed() abaixo detecta e ignora esse
  // reenvio pelo wamid, então na pior das hipóteses só desperdiça uma
  // chamada de rede da Meta, sem duplicar a resposta pro cliente.
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

        if (message.id && !(await markMessageAsProcessed(message.id))) {
          console.log(`[WHATSAPP] Mensagem ${message.id} já processada antes — ignorando reenvio duplicado da Meta.`);
          continue;
        }

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
