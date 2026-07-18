import type { NextFunction, Request, Response } from "express";
import { prisma } from "@/lib/prisma.js";

function normalizePhone(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

// Backed por Postgres, não por Map em memória: em serverless cada instância
// teria seu próprio Map, e o limite não valeria nada na prática assim que
// requisições consecutivas caíssem em instâncias diferentes (mesmo bug que
// já mordeu o histórico de chat antes de virar chat_sessions no banco).
async function checkAndRecordHit(key: string, windowMs: number, maxRequests: number): Promise<boolean> {
  const windowStart = new Date(Date.now() - windowMs);
  const count = await prisma.rateLimitHit.count({ where: { key, createdAt: { gt: windowStart } } });
  if (count >= maxRequests) return false;
  await prisma.rateLimitHit.create({ data: { key } });
  // Limpeza oportunista dos acertos vencidos dessa mesma chave, pra tabela
  // não crescer sem limite sem precisar de um cron dedicado.
  await prisma.rateLimitHit.deleteMany({ where: { key, createdAt: { lte: windowStart } } });
  return true;
}

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 15;

// Rate-limita POST /api/chat por telefone do cliente (cai pro IP se faltar),
// já que o mesmo número de WhatsApp poderia sobrecarregar o backend de IA.
export async function chatRateLimiter(req: Request, res: Response, next: NextFunction) {
  try {
    const key = `chat:${normalizePhone(req.body?.customerPhone) || req.ip || "unknown"}`;
    if (!(await checkAndRecordHit(key, WINDOW_MS, MAX_REQUESTS_PER_WINDOW))) {
      return res.status(429).json({ error: "Muitas mensagens em pouco tempo. Aguarde um instante e tente novamente." });
    }
    next();
  } catch (err) {
    next(err);
  }
}

const LOGIN_WINDOW_MS = 5 * 60_000;
const MAX_LOGIN_ATTEMPTS_PER_WINDOW = 10;

// Rate-limita POST /api/auth/login por IP+username pra dificultar força bruta.
export async function loginRateLimiter(req: Request, res: Response, next: NextFunction) {
  try {
    const username = String(req.body?.username || "").toLowerCase();
    const key = `login:${req.ip}:${username}`;
    if (!(await checkAndRecordHit(key, LOGIN_WINDOW_MS, MAX_LOGIN_ATTEMPTS_PER_WINDOW))) {
      return res.status(429).json({ error: "Muitas tentativas de login. Aguarde alguns minutos e tente novamente." });
    }
    next();
  } catch (err) {
    next(err);
  }
}

const SIGNUP_WINDOW_MS = 60 * 60_000;
const MAX_SIGNUPS_PER_WINDOW = 5;

// Rate-limita POST /api/signup por IP pra dificultar criação em massa de
// barbearias falsas (é uma rota pública, sem CAPTCHA nem verificação de
// e-mail nesta rodada).
export async function signupRateLimiter(req: Request, res: Response, next: NextFunction) {
  try {
    const key = `signup:${req.ip}`;
    if (!(await checkAndRecordHit(key, SIGNUP_WINDOW_MS, MAX_SIGNUPS_PER_WINDOW))) {
      return res.status(429).json({ error: "Muitas tentativas de cadastro. Aguarde um pouco e tente novamente." });
    }
    next();
  } catch (err) {
    next(err);
  }
}

// Rate-limita as rotas públicas de autoatendimento (cancelar/reagendar/baixar
// .ics sem passar pelo chat) por telefone, já que são não-autenticadas e só
// confiam no telefone como identidade.
export async function selfServiceRateLimiter(req: Request, res: Response, next: NextFunction) {
  try {
    const key = `self:${normalizePhone(req.body?.phone ?? req.query?.phone) || req.ip || "unknown"}`;
    if (!(await checkAndRecordHit(key, WINDOW_MS, MAX_REQUESTS_PER_WINDOW))) {
      return res.status(429).json({ error: "Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente." });
    }
    next();
  } catch (err) {
    next(err);
  }
}
