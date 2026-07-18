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

// Chamado quando o cliente confirma um agendamento — o bot avisa nesse
// momento que confirmar implica aceitar receber mensagens de marketing
// (ex: "reconquista" de cliente sumido), então isso conta como opt-in.
export function markMarketingOptIn(clientId: number) {
  return prisma.client.update({ where: { id: clientId }, data: { marketingOptIn: true } });
}

export function updateClientBirthday(clientId: number, birthday: string | null) {
  return prisma.client.update({
    where: { id: clientId },
    data: { birthday: birthday ? new Date(birthday) : null },
  });
}

// Direito de exclusão (LGPD). Client é global (mesma identidade em qualquer
// barbearia do SaaS que o telefone já tenha atendido) — anonimiza em vez de
// apagar a linha, porque Appointment/Review/ProductSale/Escalation têm FK
// obrigatória pra clientId, e os registros financeiros/de agenda da
// barbearia precisam continuar existindo por obrigação contábil própria do
// negócio. O telefone vira um valor único não reaproveitável, então a
// pessoa não fica "presa": se quiser voltar, cadastra de novo com o mesmo
// número.
export function anonymizeClient(clientId: number) {
  return prisma.client.update({
    where: { id: clientId },
    data: {
      name: "Cliente removido",
      phone: `removido-${clientId}-${Date.now()}`,
      birthday: null,
      marketingOptIn: false,
    },
  });
}
