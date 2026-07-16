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
  }
}
