import crypto from "node:crypto";

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

// Senha aleatória gerada pelo painel de super-admin pra resetar a conta de
// um usuário — exclui caracteres ambíguos (0/O, 1/l/I) pra reduzir erro de
// transcrição por quem for digitar manualmente a partir do e-mail.
const RANDOM_PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export function generateRandomPassword(length = 12): string {
  const bytes = crypto.randomBytes(length);
  let password = "";
  for (let i = 0; i < length; i++) {
    password += RANDOM_PASSWORD_ALPHABET[bytes[i]! % RANDOM_PASSWORD_ALPHABET.length];
  }
  return password;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, "hex");
  const testHash = crypto.scryptSync(password, salt, 64);
  if (testHash.length !== hashBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, testHash);
}
