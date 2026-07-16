import type { NextFunction, Request, Response } from "express";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 15;

const hits = new Map<string, number[]>();

function prune(list: number[], now: number, windowMs = WINDOW_MS) {
  while (list.length && now - list[0]! > windowMs) list.shift();
}

function normalizePhone(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

// Rate-limita POST /api/chat por telefone do cliente (cai pro IP se faltar),
// já que o mesmo número de WhatsApp poderia sobrecarregar o backend de IA.
export function chatRateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = normalizePhone(req.body?.customerPhone) || req.ip || "unknown";
  const now = Date.now();
  const list = hits.get(key) || [];
  prune(list, now);

  if (list.length >= MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({ error: "Muitas mensagens em pouco tempo. Aguarde um instante e tente novamente." });
  }

  list.push(now);
  hits.set(key, list);
  next();
}

const LOGIN_WINDOW_MS = 5 * 60_000;
const MAX_LOGIN_ATTEMPTS_PER_WINDOW = 10;
const loginHits = new Map<string, number[]>();

// Rate-limita POST /api/auth/login por IP+username pra dificultar força bruta.
export function loginRateLimiter(req: Request, res: Response, next: NextFunction) {
  const username = String(req.body?.username || "").toLowerCase();
  const key = `${req.ip}:${username}`;
  const now = Date.now();
  const list = loginHits.get(key) || [];
  prune(list, now, LOGIN_WINDOW_MS);

  if (list.length >= MAX_LOGIN_ATTEMPTS_PER_WINDOW) {
    return res.status(429).json({ error: "Muitas tentativas de login. Aguarde alguns minutos e tente novamente." });
  }

  list.push(now);
  loginHits.set(key, list);
  next();
}

const selfServiceHits = new Map<string, number[]>();

// Rate-limita as rotas públicas de autoatendimento (cancelar/reagendar sem o chat)
// por telefone, já que são não-autenticadas e só confiam no telefone como identidade.
export function selfServiceRateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = normalizePhone(req.body?.phone ?? req.query?.phone) || req.ip || "unknown";
  const now = Date.now();
  const list = selfServiceHits.get(key) || [];
  prune(list, now);

  if (list.length >= MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({ error: "Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente." });
  }

  list.push(now);
  selfServiceHits.set(key, list);
  next();
}
