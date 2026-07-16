import { prisma } from "@/lib/prisma.js";

export function getClientByPhone(phone: string) {
  return prisma.client.findUnique({ where: { phone } });
}

export function getClientById(id: number) {
  return prisma.client.findUnique({ where: { id } });
}

export async function findOrCreateClient(name: string, phone: string) {
  const existing = await getClientByPhone(phone);
  if (existing) {
    if (name && name !== existing.name) {
      return prisma.client.update({ where: { id: existing.id }, data: { name } });
    }
    return existing;
  }
  return prisma.client.create({ data: { name, phone } });
}

// Clients não têm barbershopId (identidade global pelo telefone, igual ao WhatsApp),
// então o vínculo com uma barbearia é checado pela existência de algum agendamento.
export async function clientBelongsToShop(clientId: number, barbershopId: number): Promise<boolean> {
  const appointment = await prisma.appointment.findFirst({
    where: { clientId, barbershopId },
    select: { id: true },
  });
  return !!appointment;
}

export function updateClientBirthday(clientId: number, birthday: string | null) {
  return prisma.client.update({
    where: { id: clientId },
    data: { birthday: birthday ? new Date(birthday) : null },
  });
}
