import { prisma } from "@/lib/prisma.js";

export function getUserByUsername(username: string) {
  return prisma.user.findUnique({ where: { username } });
}

export function getUserById(id: number) {
  return prisma.user.findUnique({ where: { id } });
}

export function getUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

export function getOwnerUserForBarbershop(barbershopId: number) {
  return prisma.user.findFirst({ where: { barbershopId, role: "owner" } });
}
