import type { AppointmentDTO } from "@/modules/appointments/appointments.types.js";
import { normalizeLocale, type Locale } from "@/lib/locale.js";

// Textos de lembrete/reagendamento/reconquista por idioma. Usados em dois
// lugares que PRECISAM bater com o idioma do Message Template enviado à Meta:
// os parâmetros {{n}} do template (ex: o "hint" da reconquista) e o texto de
// fallback (stub/log). pt-BR é o texto histórico, sem mudança.
export function rescheduleNoticeText(locale: string, a: AppointmentDTO): string {
  const l: Locale = normalizeLocale(locale);
  if (l === "fr") {
    return (
      `Bonjour ${a.clientName} ! 😥 Nous devons déplacer votre rendez-vous (${a.serviceName} avec ${a.barberName}) ` +
      `prévu à ${a.startTime} le ${a.date} en raison d'un imprévu dans notre planning. Nous nous excusons pour la gêne !\n\n` +
      `Pourriez-vous répondre ici afin que nous trouvions ensemble un nouveau créneau qui vous convienne ? 🙏`
    );
  }
  if (l === "en") {
    return (
      `Hi ${a.clientName}! 😥 We need to reschedule your ${a.serviceName} appointment with ${a.barberName} ` +
      `at ${a.startTime} on ${a.date} due to an unexpected change in our schedule. Sorry for the inconvenience!\n\n` +
      `Could you reply here so we can find a new time that works for you? 🙏`
    );
  }
  return (
    `Olá, ${a.clientName}! 😥 Precisamos remarcar seu horário de ${a.serviceName} ` +
    `com ${a.barberName} às ${a.startTime} no dia ${a.date} por um imprevisto ` +
    `na nossa agenda. Desculpe o transtorno!\n\n` +
    `Poderia responder aqui pra gente já encontrar um novo horário que funcione pra você? 🙏`
  );
}

export function comeBackHint(locale: string, last: AppointmentDTO | null): string {
  const l: Locale = normalizeLocale(locale);
  if (l === "fr") {
    return last
      ? `Et si vous réserviez dès maintenant un nouveau créneau « ${last.serviceName} » avec ${last.barberName} ?`
      : `Et si vous réserviez dès maintenant votre prochain créneau avant que l'agenda ne se remplisse ?`;
  }
  if (l === "en") {
    return last
      ? `Why not book another ${last.serviceName} with ${last.barberName} right now?`
      : `Why not grab your next slot now before the schedule fills up?`;
  }
  return last
    ? `Que tal já garantir um novo ${last.serviceName} com ${last.barberName}?`
    : `Que tal já garantir seu próximo horário antes que a agenda fique cheia?`;
}

export function comeBackText(locale: string, clientName: string, shopName: string, last: AppointmentDTO | null, emoji: string): string {
  const l: Locale = normalizeLocale(locale);
  const hint = comeBackHint(l, last);
  if (l === "fr") {
    return (
      `Bonjour ${clientName} ! 👋 Cela fait un moment que nous ne vous avons pas vu chez ${shopName}... ` +
      `vous nous manquez ! ${emoji}😄\n\n${hint} Répondez simplement ici et nous vous trouvons un créneau. À bientôt ! 🙌`
    );
  }
  if (l === "en") {
    return (
      `Hi ${clientName}! 👋 It's been a while since we saw you at ${shopName}... ` +
      `we miss you! ${emoji}😄\n\n${hint} Just reply here and we'll fit you in. See you soon! 🙌`
    );
  }
  return (
    `Oi, ${clientName}! 👋 Faz um tempinho que a gente não te vê por aqui na ${shopName}... ` +
    `sentimos sua falta! ${emoji}😄\n\n${hint} ` +
    `É só responder aqui que a gente já encaixa você. Esperamos por você! 🙌`
  );
}

export function reminderText(locale: string, a: AppointmentDTO, confirmUrl: string, emoji: string): string {
  const l: Locale = normalizeLocale(locale);
  if (l === "fr") {
    return (
      `Bonjour ${a.clientName} ! 👋 Petit rappel de votre rendez-vous aujourd'hui :\n\n` +
      `${emoji} ${a.serviceName} avec ${a.barberName}\n🕐 ${a.startTime}\n📍 ${a.barbershopName}\n\n` +
      `Confirmez votre présence : ${confirmUrl}\n\nSi vous devez le déplacer, répondez simplement ici.`
    );
  }
  if (l === "en") {
    return (
      `Hi ${a.clientName}! 👋 Just a reminder of your appointment today:\n\n` +
      `${emoji} ${a.serviceName} with ${a.barberName}\n🕐 ${a.startTime}\n📍 ${a.barbershopName}\n\n` +
      `Please confirm you're coming: ${confirmUrl}\n\nIf you need to reschedule, just reply here.`
    );
  }
  return (
    `Olá, ${a.clientName}! 👋 Passando pra lembrar do seu horário hoje:\n\n` +
    `${emoji} ${a.serviceName} com ${a.barberName}\n` +
    `🕐 ${a.startTime}\n` +
    `📍 ${a.barbershopName}\n\n` +
    `Confirme sua presença: ${confirmUrl}\n\n` +
    `Se precisar remarcar, é só responder aqui.`
  );
}

// Avisos fixos que o bot manda ao cliente final (não passam pela IA).
export type BotNoticeKey = "billingBlocked" | "repeat" | "problem" | "audioNotUnderstood" | "textOnly" | "textOrAudioOnly";

const BOT_NOTICES: Record<Locale, Record<BotNoticeKey, string>> = {
  "pt-BR": {
    billingBlocked: "No momento não estamos com o atendimento automático disponível. Em breve alguém vai te responder por aqui, obrigado pela paciência!",
    repeat: "Desculpe, pode repetir?",
    problem: "Desculpe, tive um problema para processar seu pedido. Pode tentar novamente?",
    audioNotUnderstood: "Não consegui entender esse áudio 🙏 Pode tentar mandar de novo, ou escrever o que você precisa?",
    textOnly: "Por enquanto só consigo entender mensagens de texto 🙏 Pode escrever o que você precisa?",
    textOrAudioOnly: "Por enquanto só consigo entender mensagens de texto ou áudio 🙏 Pode escrever ou gravar o que você precisa?",
  },
  fr: {
    billingBlocked: "Le service de réponse automatique n'est pas disponible pour le moment. Quelqu'un vous répondra ici très bientôt, merci de votre patience !",
    repeat: "Désolé, pouvez-vous répéter ?",
    problem: "Désolé, j'ai eu un problème pour traiter votre demande. Pouvez-vous réessayer ?",
    audioNotUnderstood: "Je n'ai pas réussi à comprendre ce message vocal 🙏 Pouvez-vous le renvoyer, ou écrire ce dont vous avez besoin ?",
    textOnly: "Pour l'instant je ne comprends que les messages texte 🙏 Pouvez-vous écrire ce dont vous avez besoin ?",
    textOrAudioOnly: "Pour l'instant je ne comprends que les messages texte ou vocaux 🙏 Pouvez-vous écrire ou enregistrer ce dont vous avez besoin ?",
  },
  en: {
    billingBlocked: "Automatic replies aren't available right now. Someone will get back to you here shortly — thanks for your patience!",
    repeat: "Sorry, could you repeat that?",
    problem: "Sorry, I had a problem processing your request. Could you try again?",
    audioNotUnderstood: "I couldn't understand that voice message 🙏 Could you send it again, or write what you need?",
    textOnly: "For now I can only understand text messages 🙏 Could you write what you need?",
    textOrAudioOnly: "For now I can only understand text or voice messages 🙏 Could you write or record what you need?",
  },
};

export function botNotice(locale: string | null | undefined, key: BotNoticeKey): string {
  return BOT_NOTICES[normalizeLocale(locale)][key];
}
