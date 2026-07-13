import crypto from "node:crypto";

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, "hex");
  const testHash = crypto.scryptSync(password, salt, 64);
  if (testHash.length !== hashBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, testHash);
}

export function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Não autenticado" });
  }
  next();
}

export function requireOwner(req, res, next) {
  if (req.session?.user?.role !== "owner") {
    return res.status(403).json({ error: "Acesso restrito ao dono da barbearia" });
  }
  next();
}
