import type { Request, Response, NextFunction } from "express";
import "@/middleware/session.js";
import { isBillingBlocked } from "@/modules/billing/billing.service.js";

// Prefixos que continuam liberados mesmo com a assinatura cancelada — sem
// isso a própria pessoa ficaria sem como escolher um plano pra se destravar.
// Tudo que NÃO está aqui e tem sessão logada (dono ou profissional) passa
// pela checagem de billing abaixo. Rotas sem sessão (login, público de
// autoatendimento do cliente final, webhooks) não são afetadas por este
// middleware — ele só age quando já existe req.session.user.
const EXEMPT_PREFIXES = [
  "/api/auth/", // login/logout/me têm que sempre funcionar, inclusive pra sair da conta travada
  "/api/billing/", // status, checkout, portal, change-plan — é o próprio caminho de destravar
  "/api/public/", // autoatendimento do cliente final (não é o painel, ver decisão do bloqueio)
  "/api/webhooks/", // Stripe/WhatsApp — sem sessão de usuário, nunca cai aqui de qualquer forma
  "/api/superadmin", // painel da plataforma, sessão própria (superAdmin), não afetado por billing de barbearia
  "/api/signup",
  "/api/verify-email",
  "/api/push/", // manter inscrição de notificação viva não tem custo nem sentido bloquear
];

// Bloqueio real do painel (dono/profissional) quando a assinatura da
// barbearia está cancelada — ver isBillingBlocked em billing.service.ts pra
// critério exato. O bot de WhatsApp é bloqueado à parte, dentro de
// chatEngine.sendMessage (mesma função usada pelo webhook real e pelo
// simulador /api/chat), porque ali a resposta certa não é um erro HTTP e
// sim uma mensagem fixa pro cliente final.
export async function requireBillingOk(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api/")) return next();
  if (EXEMPT_PREFIXES.some((p) => req.path.startsWith(p))) return next();
  if (!req.session?.user) return next(); // sem sessão: requireAuth da rota real cuida do 401

  try {
    const blocked = await isBillingBlocked(req.session.user.businessId);
    if (blocked) {
      return res.status(402).json({
        error: "billing_blocked",
        message: "A assinatura desta conta está cancelada. Escolha um plano pra continuar usando o painel.",
      });
    }
  } catch {
    // Falha ao checar billing (ex: banco fora do ar por um instante) nunca
    // deve travar o painel inteiro por conta própria — segue sem bloquear.
  }
  next();
}
