import crypto from "node:crypto";
import { prisma } from "@/lib/prisma.js";

// Encurtador genérico — hoje usado só pro link de checkout do Stripe que o
// bot manda por WhatsApp. Sem expiração própria: a sessão do Stripe por trás
// já expira sozinha (24h por padrão), então um código "morto" aqui só
// redireciona pra uma sessão que o Stripe já vai recusar.
export async function createShortLink(url: string): Promise<string> {
  const code = crypto.randomBytes(5).toString("base64url");
  await prisma.shortLink.create({ data: { code, url } });
  return code;
}

export async function resolveShortLink(code: string): Promise<string | null> {
  const link = await prisma.shortLink.findUnique({ where: { code } });
  return link?.url ?? null;
}
