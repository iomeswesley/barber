import { Router } from "express";
import { Prisma } from "@prisma/client";
import { env } from "@/config/env.js";
import { prisma } from "@/lib/prisma.js";
import {
  verifyWebhookSignature,
  sendWhatsappText,
  whatsappConfigured,
  resolveBarbershopAccessToken,
  downloadWhatsappMedia,
} from "@/lib/whatsapp.js";
import { transcribeAudio, transcriptionConfigured } from "@/lib/transcription.js";
import { getBarbershopByWhatsappPhoneNumberId } from "@/modules/businesses/businesses.repository.js";
import { recordIncomingMessage, generateReplyFromHistory, hasNewerCustomerMessage } from "@/modules/chat/chatEngine.js";
import { setWhatsappConnectionStatusByWabaId } from "@/modules/whatsappConnect/whatsappConnect.repository.js";
import { markWhatsappDisconnectedIfNeeded, markWhatsappReconnectedIfNeeded } from "@/modules/whatsappConnect/whatsappConnect.service.js";
import { isKnownNonCustomerSender } from "@/lib/nonCustomerSenders.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    id?: string;
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { profile?: { name?: string }; wa_id?: string }[];
        messages?: {
          id?: string;
          from?: string;
          type?: string;
          text?: { body?: string };
          audio?: { id?: string; mime_type?: string };
        }[];
        event?: string;
        message_template_name?: string;
      };
    }[];
  }[];
}

// Aprovação de template é assíncrona e por WABA (não por número) — a Meta
// manda um evento desses por template. Simplificação: como o WhatsApp
// Connect submete todos os templates junto na conexão, tratamos a primeira
// aprovação como "conectado" e qualquer rejeição como erro (best-effort;
// não rastreia individualmente cada um dos N templates pendentes).
async function handleTemplateStatusUpdate(wabaId: string, event: string | undefined, templateName: string | undefined) {
  if (event === "APPROVED") {
    await setWhatsappConnectionStatusByWabaId(wabaId, "connected");
  } else if (event === "REJECTED") {
    console.error(`[WHATSAPP CONNECT] Template "${templateName}" rejeitado pela Meta na WABA ${wabaId}`);
    await setWhatsappConnectionStatusByWabaId(wabaId, "error");
  }
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
        if (change.field === "message_template_status_update") {
          if (entry.id) await handleTemplateStatusUpdate(entry.id, change.value?.event, change.value?.message_template_name);
          continue;
        }
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

        // Achado em produção (2026-09-08): em modo Coexistência o número
        // continua recebendo tudo que já recebia antes (operadora, banco,
        // promoção) — sem esse filtro, a IA tentava agendar corte de
        // cabelo com a Claro. Silencioso de propósito (nem responde "só
        // entendo texto", nem salva no histórico) — mandar qualquer coisa
        // pra uma operadora/banco só confundiria mais.
        if (isKnownNonCustomerSender(pushName)) {
          console.log(`[WHATSAPP] Mensagem de "${pushName}" (${from}) ignorada — remetente reconhecido como não-cliente.`);
          continue;
        }

        const accessToken = resolveBarbershopAccessToken(barbershop);

        // sendWhatsappText envolto no mesmo padrão de detecção de
        // desconexão (try/catch + markWhatsapp{Dis,Re}connectedIfNeeded)
        // usado nos três pontos que já mandavam mensagem por aqui — extraído
        // porque agora são 4 (aviso de mídia não suportada, aviso de áudio
        // não entendido, bloqueio de cobrança/IA pausada, resposta da IA).
        async function sendBotReply(text: string) {
          try {
            await sendWhatsappText(phoneNumberId!, from, text, accessToken);
            await markWhatsappReconnectedIfNeeded(barbershop!.id);
          } catch (err) {
            // Achado em produção (2026-09-07): a conexão pode cair de
            // verdade (dono desconectou pelo celular) sem nenhum aviso
            // prévio — sem isso, o painel continuava dizendo "conectado"
            // até alguém checar manualmente direto na Meta.
            await markWhatsappDisconnectedIfNeeded(barbershop!.id, err);
            throw err;
          }
        }

        // Mensagem de voz: baixa o áudio da Meta e transcreve via Groq (ver
        // src/lib/transcription.ts) — acessibilidade pra quem tem
        // dificuldade de escrever mas consegue mandar áudio. Se a
        // transcrição falhar (sem GROQ_API_KEY configurada, erro de rede,
        // áudio incompreensível) avisa e pede pra tentar de novo ou
        // escrever, em vez de travar silenciosamente.
        let textToUse: string | undefined = message.type === "text" ? message.text?.body : undefined;
        if (message.type === "audio" && message.audio?.id) {
          try {
            const { buffer, mimeType } = await downloadWhatsappMedia(message.audio.id, accessToken);
            const transcribed = await transcribeAudio(buffer, mimeType);
            // Prefixo salvo no histórico (não só mostrado) de propósito: dá
            // transparência pro dono na aba Conversas (fica claro que veio
            // de um áudio, não digitado) e ajuda a própria IA a não
            // estranhar eventuais erros de reconhecimento de fala.
            textToUse = transcribed ? `[Áudio transcrito] ${transcribed}` : undefined;
          } catch (err) {
            console.error("[WHATSAPP] Falha ao baixar/transcrever áudio:", (err as Error).message);
            textToUse = undefined;
          }
          if (!textToUse) {
            await sendBotReply(
              transcriptionConfigured
                ? "Não consegui entender esse áudio 🙏 Pode tentar mandar de novo, ou escrever o que você precisa?"
                : "Por enquanto só consigo entender mensagens de texto 🙏 Pode escrever o que você precisa?"
            );
            continue;
          }
        }

        // Qualquer outra mídia (foto, figurinha, vídeo, documento etc.) não
        // vai pra IA (só entende texto) — sem isso, o cliente mandaria algo
        // e não receberia resposta nenhuma, parecendo que o bot travou.
        if (!textToUse) {
          await sendBotReply("Por enquanto só consigo entender mensagens de texto ou áudio 🙏 Pode escrever ou gravar o que você precisa?");
          continue;
        }

        const recorded = await recordIncomingMessage(barbershop.id, from, textToUse, from);
        if (recorded.status === "immediate") {
          // null = IA pausada nessa conversa (toggle "IA Ativa" em Mensagens)
          // ou geral — a mensagem do cliente já foi salva no histórico, mas
          // não manda nada automático de volta; o dono responde manualmente.
          if (recorded.reply) await sendBotReply(recorded.reply);
          continue;
        }

        // Debounce: espera até WHATSAPP_REPLY_DEBOUNCE_MS (20s por padrão)
        // de silêncio do cliente antes de responder, pra juntar mensagens
        // mandadas em sequência rápida (ex: "oi", "queria marcar um corte",
        // "amanhã de tarde" em 3 mensagens separadas) numa resposta só, em
        // vez de responder cada uma isoladamente. Cada mensagem nova
        // "cancela" a espera das anteriores — a invocação de uma mensagem
        // que não é mais a mais recente da conversa percebe isso e desiste
        // cedo (sem gastar o resto do tempo à toa); só a invocação da
        // ÚLTIMA mensagem da rajada chega ao fim da espera e efetivamente
        // gera e manda a resposta. Fica fora de qualquer transação de banco
        // de propósito (ver recordIncomingMessage/generateReplyFromHistory)
        // — não dá pra segurar um lock de linha por 20s.
        let elapsedMs = 0;
        let supersededByNewerMessage = false;
        while (elapsedMs < env.WHATSAPP_REPLY_DEBOUNCE_MS) {
          await sleep(env.WHATSAPP_REPLY_DEBOUNCE_POLL_MS);
          elapsedMs += env.WHATSAPP_REPLY_DEBOUNCE_POLL_MS;
          if (await hasNewerCustomerMessage(barbershop.id, from, recorded.queuedAt)) {
            supersededByNewerMessage = true;
            break;
          }
        }
        if (supersededByNewerMessage) continue;

        const reply = await generateReplyFromHistory(barbershop.id, from, from, pushName);
        if (reply) await sendBotReply(reply);
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
