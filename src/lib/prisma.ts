import { PrismaClient } from "@prisma/client";
import { isProduction } from "@/config/env.js";

// Reaproveita a instância entre reloads do tsx watch em dev, para não abrir
// uma nova pool de conexões a cada mudança de arquivo.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ["error", "warn"] : ["error", "warn"],
  });

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}
