import type { UserRole } from "@prisma/client";

// Formato do usuário autenticado guardado na sessão — espelha o session.user
// do barbearia-bot original, mas com tipos explícitos.
export interface SessionUser {
  id: number;
  role: UserRole;
  barbershopId: number;
  barberId: number | null;
  name: string;
}

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
    // Sessão do painel de administração da plataforma — não tem relação
    // com nenhuma barbearia, então fica em campo separado de `user`
    // (que sempre carrega um barbershopId).
    superAdmin?: boolean;
  }
}
