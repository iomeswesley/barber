const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 15;

const hits = new Map(); // key -> array of timestamps (ms)

function prune(list, now, windowMs = WINDOW_MS) {
  while (list.length && now - list[0] > windowMs) list.shift();
}

// Express middleware: rate-limits POST /api/chat per client phone number (falls back to IP),
// since the same WhatsApp number could otherwise flood the AI backend with messages.
export function chatRateLimiter(req, res, next) {
  const key = String(req.body?.customerPhone || req.ip || "unknown").replace(/\D/g, "") || req.ip;
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

const loginHits = new Map(); // key (ip+username) -> array of timestamps (ms)

// Rate-limits POST /api/auth/login per IP+username to slow down brute-force password guessing.
export function loginRateLimiter(req, res, next) {
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
