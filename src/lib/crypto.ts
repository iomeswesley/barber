import crypto from "node:crypto";
import { env } from "@/config/env.js";

// Criptografia simétrica pra segredos por-tenant que precisam ser recuperados
// em texto puro depois (diferente de senha, que só compara hash) — hoje usado
// só pro token de acesso e PIN de registro do WhatsApp Embedded Signup de
// cada barbearia (ver src/modules/whatsappConnect). AES-256-GCM: IV aleatório
// por chamada + auth tag, tudo concatenado em base64 num único campo.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  if (!env.WHATSAPP_TOKEN_ENCRYPTION_KEY) {
    throw new Error("WHATSAPP_TOKEN_ENCRYPTION_KEY não configurada — não é possível criptografar/descriptografar segredos.");
  }
  const key = Buffer.from(env.WHATSAPP_TOKEN_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error("WHATSAPP_TOKEN_ENCRYPTION_KEY inválida — precisa ser 32 bytes em base64.");
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = raw.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
