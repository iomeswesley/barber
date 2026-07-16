import type { Request, Response, NextFunction } from "express";
import "@/middleware/session.js";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Não autenticado" });
  }
  next();
}

export function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (req.session?.user?.role !== "owner") {
    return res.status(403).json({ error: "Acesso restrito ao dono da barbearia" });
  }
  next();
}

export function requireBarber(req: Request, res: Response, next: NextFunction) {
  if (req.session?.user?.role !== "barber") {
    return res.status(403).json({ error: "Somente barbeiros" });
  }
  next();
}

// Helper central de isolamento de tenant: toda rota que carrega um recurso por id
// (agendamento, produto, barbeiro, bloqueio...) deve comparar seu barbershopId
// contra req.session.user.barbershopId usando esta função, em vez de reescrever
// a checagem em cada handler — um único lugar pra auditar o isolamento entre tenants.
export function belongsToSession(
  req: Request,
  resource: { barbershopId: number } | null | undefined
): boolean {
  return !!resource && resource.barbershopId === req.session.user?.barbershopId;
}
