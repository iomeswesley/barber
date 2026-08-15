import type { Request, Response, NextFunction } from "express";
import "@/middleware/session.js";
import { vertical } from "@/config/env.js";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Não autenticado" });
  }
  next();
}

export function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (req.session?.user?.role !== "owner") {
    return res.status(403).json({ error: `Acesso restrito ao dono da ${vertical.business}` });
  }
  next();
}

export function requireBarber(req: Request, res: Response, next: NextFunction) {
  if (req.session?.user?.role !== "professional") {
    return res.status(403).json({ error: `Somente ${vertical.professionalPlural}` });
  }
  next();
}

// Painel de administração da plataforma — sessão própria (`superAdmin`),
// sem relação com o login de dono/barbeiro de uma barbearia.
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.superAdmin) {
    return res.status(401).json({ error: "Não autenticado" });
  }
  next();
}

// Helper central de isolamento de tenant: toda rota que carrega um recurso por id
// (agendamento, produto, barbeiro, bloqueio...) deve comparar seu businessId
// contra req.session.user.businessId usando esta função, em vez de reescrever
// a checagem em cada handler — um único lugar pra auditar o isolamento entre tenants.
export function belongsToSession(
  req: Request,
  resource: { businessId: number } | null | undefined
): boolean {
  return !!resource && resource.businessId === req.session.user?.businessId;
}
