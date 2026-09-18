import { Router } from "express";
import { requireAuth, requireOwner } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { env } from "@/config/env.js";
import { prisma } from "@/lib/prisma.js";
import { encryptSecret, decryptSecret } from "@/lib/crypto.js";
import {
  whatsappConnectConfigured,
  exchangeCodeForToken,
  generateRegistrationPin,
  registerPhoneNumber,
  subscribeAppToWaba,
  getDisplayPhoneNumber,
  createTemplates,
  deregisterPhoneNumber,
} from "./whatsappConnect.service.js";
import {
  getWhatsappConnection,
  saveWhatsappConnection,
  clearWhatsappConnection,
  getWhatsappAccessTokenEnc,
} from "./whatsappConnect.repository.js";

export const whatsappConnectRouter = Router();

whatsappConnectRouter.get("/api/manage/whatsapp/connect/config", requireAuth, requireOwner, (_req, res) => {
  res.json({
    configured: whatsappConnectConfigured,
    app_id: env.WHATSAPP_APP_ID || null,
    config_id: env.WHATSAPP_CONFIG_ID || null,
    // Sem Configuration dedicada de Coexistence ainda, cai pro config_id
    // padrão — mesmo comportamento de antes dessa separação existir.
    config_id_coexistence: env.WHATSAPP_CONFIG_ID_COEXISTENCE || env.WHATSAPP_CONFIG_ID || null,
  });
});

whatsappConnectRouter.get("/api/manage/whatsapp/connect/status", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const businessId = req.session.user!.businessId;
    const connection = await getWhatsappConnection(businessId);
    res.json({
      status: connection?.whatsappConnectionStatus || "not_connected",
      display_phone: connection?.whatsappDisplayPhone || null,
      coexistence: connection?.whatsappCoexistence || false,
    });
  } catch (err) {
    next(err);
  }
});

whatsappConnectRouter.post("/api/manage/whatsapp/connect/callback", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const businessId = req.session.user!.businessId;
    const {
      code,
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      is_coexistence: isCoexistence,
    } = req.body as {
      code?: string;
      waba_id?: string;
      phone_number_id?: string;
      is_coexistence?: boolean;
    };
    if (!code || !wabaId || !phoneNumberId) {
      throw new AppError("Dados incompletos vindos do popup de conexão do WhatsApp.");
    }

    const accessToken = await exchangeCodeForToken(code);

    // Coexistence: o número já está registrado na Cloud API pelo próprio
    // WhatsApp Business App do dono — não gera PIN nem chama /register (ver
    // comentário em registerPhoneNumber, whatsappConnect.service.ts).
    let pinEnc: string | null = null;
    if (!isCoexistence) {
      const pin = generateRegistrationPin();
      await registerPhoneNumber(phoneNumberId, accessToken, pin);
      pinEnc = encryptSecret(pin);
    }

    await subscribeAppToWaba(wabaId, accessToken);
    const displayPhone = await getDisplayPhoneNumber(phoneNumberId, accessToken);

    await saveWhatsappConnection(businessId, {
      wabaId,
      phoneNumberId,
      accessTokenEnc: encryptSecret(accessToken),
      pinEnc,
      displayPhone,
      status: "pending_templates",
      coexistence: !!isCoexistence,
    });

    // Templates no idioma configurado do negócio (Business.locale) — cada
    // idioma é aprovado separado pela Meta, então só criamos o do próprio
    // negócio (pt-BR pros existentes; fr/en pra Luxemburgo).
    const business = await prisma.business.findUnique({ where: { id: businessId }, select: { locale: true } });
    const templateResults = await createTemplates(wabaId, accessToken, business?.locale);
    const failed = templateResults.filter((t) => !t.ok);
    if (failed.length > 0) {
      console.error(`[WHATSAPP CONNECT] Falha ao criar templates na WABA ${wabaId}:`, failed);
    }

    res.json({ status: "pending_templates", display_phone: displayPhone, coexistence: !!isCoexistence });
  } catch (err) {
    next(err);
  }
});

whatsappConnectRouter.post("/api/manage/whatsapp/connect/disconnect", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const businessId = req.session.user!.businessId;

    // Antes só limpava nosso banco — o número continuava registrado de
    // verdade na Cloud API da Meta, e uma tentativa posterior de conectar
    // ele em outra conta (nossa ou não) era rejeitada com "already
    // registered to another account", mesmo já não aparecendo mais
    // conectado no nosso painel (achado em produção, 13/09). Tenta liberar
    // de verdade primeiro (best-effort — token/dados precisam ser lidos
    // ANTES de clearWhatsappConnection apagar tudo).
    const connection = await getWhatsappConnection(businessId);
    let metaReleased: boolean | null = null;
    if (connection?.whatsappPhoneNumberId) {
      const tokenEnc = await getWhatsappAccessTokenEnc(businessId);
      if (tokenEnc) {
        try {
          const accessToken = decryptSecret(tokenEnc);
          metaReleased = await deregisterPhoneNumber(connection.whatsappPhoneNumberId, accessToken);
        } catch (err) {
          console.error("[WHATSAPP CONNECT] Falha ao descriptografar token pra desregistrar o número:", (err as Error).message);
          metaReleased = false;
        }
      } else {
        metaReleased = false; // Coexistence sem token próprio salvo, ou nunca teve — nada pra chamar
      }
    }

    await clearWhatsappConnection(businessId);
    res.json({ status: "not_connected", meta_released: metaReleased });
  } catch (err) {
    next(err);
  }
});
