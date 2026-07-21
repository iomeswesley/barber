import { prisma } from "@/lib/prisma.js";

export function getWhatsappConnection(barbershopId: number) {
  return prisma.barbershop.findUnique({
    where: { id: barbershopId },
    select: {
      whatsappWabaId: true,
      whatsappPhoneNumberId: true,
      whatsappDisplayPhone: true,
      whatsappConnectionStatus: true,
    },
  });
}

export function saveWhatsappConnection(
  barbershopId: number,
  data: {
    wabaId: string;
    phoneNumberId: string;
    accessTokenEnc: string;
    pinEnc: string;
    displayPhone: string | null;
    status: string;
  }
) {
  return prisma.barbershop.update({
    where: { id: barbershopId },
    data: {
      whatsappWabaId: data.wabaId,
      whatsappPhoneNumberId: data.phoneNumberId,
      whatsappAccessTokenEnc: data.accessTokenEnc,
      whatsappPinEnc: data.pinEnc,
      whatsappDisplayPhone: data.displayPhone,
      whatsappConnectionStatus: data.status,
    },
  });
}

export function setWhatsappConnectionStatusByWabaId(wabaId: string, status: string) {
  return prisma.barbershop.updateMany({ where: { whatsappWabaId: wabaId }, data: { whatsappConnectionStatus: status } });
}

// Token de acesso descriptografado, só pra uso interno de envio (nunca sai
// pra fora do backend) — separado de getWhatsappConnection pra não expor o
// campo criptografado sem necessidade em rotas que só mostram status.
export function getWhatsappAccessTokenEnc(barbershopId: number) {
  return prisma.barbershop
    .findUnique({ where: { id: barbershopId }, select: { whatsappAccessTokenEnc: true } })
    .then((r) => r?.whatsappAccessTokenEnc ?? null);
}
