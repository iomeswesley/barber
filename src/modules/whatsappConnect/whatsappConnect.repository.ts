import { prisma } from "@/lib/prisma.js";

export function getWhatsappConnection(businessId: number) {
  return prisma.business.findUnique({
    where: { id: businessId },
    select: {
      whatsappWabaId: true,
      whatsappPhoneNumberId: true,
      whatsappDisplayPhone: true,
      whatsappConnectionStatus: true,
      whatsappCoexistence: true,
    },
  });
}

export function saveWhatsappConnection(
  businessId: number,
  data: {
    wabaId: string;
    phoneNumberId: string;
    accessTokenEnc: string;
    pinEnc: string | null;
    displayPhone: string | null;
    status: string;
    coexistence: boolean;
  }
) {
  return prisma.business.update({
    where: { id: businessId },
    data: {
      whatsappWabaId: data.wabaId,
      whatsappPhoneNumberId: data.phoneNumberId,
      whatsappAccessTokenEnc: data.accessTokenEnc,
      whatsappPinEnc: data.pinEnc,
      whatsappDisplayPhone: data.displayPhone,
      whatsappConnectionStatus: data.status,
      whatsappCoexistence: data.coexistence,
    },
  });
}

export function setWhatsappConnectionStatusByWabaId(wabaId: string, status: string) {
  return prisma.business.updateMany({ where: { whatsappWabaId: wabaId }, data: { whatsappConnectionStatus: status } });
}

// Limpa a conexão salva no banco (usado pelo botão "Desconectar" no painel).
// Não revoga o token do lado da Meta nem desfaz o registro do número na Cloud
// API — só reseta o estado local pra permitir reconectar (inclusive
// reconectar o mesmo número de novo) pelo próprio fluxo self-service.
export function clearWhatsappConnection(businessId: number) {
  return prisma.business.update({
    where: { id: businessId },
    data: {
      whatsappWabaId: null,
      whatsappPhoneNumberId: null,
      whatsappAccessTokenEnc: null,
      whatsappPinEnc: null,
      whatsappDisplayPhone: null,
      whatsappConnectionStatus: "not_connected",
      whatsappCoexistence: false,
    },
  });
}

// Token de acesso descriptografado, só pra uso interno de envio (nunca sai
// pra fora do backend) — separado de getWhatsappConnection pra não expor o
// campo criptografado sem necessidade em rotas que só mostram status.
export function getWhatsappAccessTokenEnc(businessId: number) {
  return prisma.business
    .findUnique({ where: { id: businessId }, select: { whatsappAccessTokenEnc: true } })
    .then((r) => r?.whatsappAccessTokenEnc ?? null);
}
