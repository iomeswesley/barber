import { Router } from "express";
import { requireAuth, requireOwner } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { env } from "@/config/env.js";
import { encryptSecret } from "@/lib/crypto.js";
import {
  whatsappConnectConfigured,
  exchangeCodeForToken,
  generateRegistrationPin,
  registerPhoneNumber,
  subscribeAppToWaba,
  getDisplayPhoneNumber,
  createTemplates,
} from "./whatsappConnect.service.js";
import { getWhatsappConnection, saveWhatsappConnection } from "./whatsappConnect.repository.js";

export const whatsappConnectRouter = Router();

whatsappConnectRouter.get("/api/manage/whatsapp/connect/config", requireAuth, requireOwner, (_req, res) => {
  res.json({
    configured: whatsappConnectConfigured,
    app_id: env.WHATSAPP_APP_ID || null,
    config_id: env.WHATSAPP_CONFIG_ID || null,
  });
});

whatsappConnectRouter.get("/api/manage/whatsapp/connect/status", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const barbershopId = req.session.user!.barbershopId;
    const connection = await getWhatsappConnection(barbershopId);
    res.json({
      status: connection?.whatsappConnectionStatus || "not_connected",
      display_phone: connection?.whatsappDisplayPhone || null,
    });
  } catch (err) {
    next(err);
  }
});

whatsappConnectRouter.post("/api/manage/whatsapp/connect/callback", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const barbershopId = req.session.user!.barbershopId;
    const { code, waba_id: wabaId, phone_number_id: phoneNumberId } = req.body as {
      code?: string;
      waba_id?: string;
      phone_number_id?: string;
    };
    if (!code || !wabaId || !phoneNumberId) {
      throw new AppError("Dados incompletos vindos do popup de conexão do WhatsApp.");
    }

    const accessToken = await exchangeCodeForToken(code);
    const pin = generateRegistrationPin();
    await registerPhoneNumber(phoneNumberId, accessToken, pin);
    await subscribeAppToWaba(wabaId, accessToken);
    const displayPhone = await getDisplayPhoneNumber(phoneNumberId, accessToken);

    await saveWhatsappConnection(barbershopId, {
      wabaId,
      phoneNumberId,
      accessTokenEnc: encryptSecret(accessToken),
      pinEnc: encryptSecret(pin),
      displayPhone,
      status: "pending_templates",
    });

    const templateResults = await createTemplates(wabaId, accessToken);
    const failed = templateResults.filter((t) => !t.ok);
    if (failed.length > 0) {
      console.error(`[WHATSAPP CONNECT] Falha ao criar templates na WABA ${wabaId}:`, failed);
    }

    res.json({ status: "pending_templates", display_phone: displayPhone });
  } catch (err) {
    next(err);
  }
});
