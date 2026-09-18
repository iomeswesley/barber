import { normalizeLocale, type Locale } from "@/lib/locale.js";

// Texto dos e-mails transacionais por idioma. Os destinatários são donos/
// barbeiros da região do deploy, então o idioma vem de APP_DEFAULT_LOCALE
// (quem chama passa o valor) — pt-BR é o texto histórico, sem mudança.
export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const PRODUCT = { "pt-BR": "Painel da Barbearia", fr: "Tableau de bord du barbershop", en: "Barbershop dashboard" } as const;

export function verificationEmail(locale: string, ownerName: string, verifyUrl: string): EmailContent {
  const l: Locale = normalizeLocale(locale);
  if (l === "fr") {
    return {
      subject: `Confirmez votre e-mail — ${PRODUCT.fr}`,
      html: `
      <p>Bonjour ${ownerName} !</p>
      <p>Confirmez votre e-mail pour activer votre compte sur le tableau de bord de votre barbershop :</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>Ce lien expire dans 24 heures.</p>
    `,
      text: `Bonjour ${ownerName} !\n\nConfirmez votre e-mail pour activer votre compte sur le tableau de bord de votre barbershop :\n${verifyUrl}\n\nCe lien expire dans 24 heures.`,
    };
  }
  if (l === "en") {
    return {
      subject: `Confirm your email — ${PRODUCT.en}`,
      html: `
      <p>Hi ${ownerName}!</p>
      <p>Confirm your email to activate your account on your barbershop dashboard:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>This link expires in 24 hours.</p>
    `,
      text: `Hi ${ownerName}!\n\nConfirm your email to activate your account on your barbershop dashboard:\n${verifyUrl}\n\nThis link expires in 24 hours.`,
    };
  }
  return {
    subject: `Confirme seu e-mail — ${PRODUCT["pt-BR"]}`,
    html: `
      <p>Oi, ${ownerName}!</p>
      <p>Confirme seu e-mail pra ativar sua conta no painel da barbearia:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>Esse link expira em 24 horas.</p>
    `,
    text: `Oi, ${ownerName}!\n\nConfirme seu e-mail pra ativar sua conta no painel da barbearia:\n${verifyUrl}\n\nEsse link expira em 24 horas.`,
  };
}

export function passwordResetEmail(locale: string, name: string, username: string, resetUrl: string): EmailContent {
  const l: Locale = normalizeLocale(locale);
  if (l === "fr") {
    return {
      subject: `Réinitialiser votre mot de passe — ${PRODUCT.fr}`,
      html: `
      <p>Bonjour ${name} !</p>
      <p>Une réinitialisation du mot de passe de votre compte a été demandée. Votre identifiant de connexion est <b>${username}</b>.</p>
      <p>Si c'est bien vous, cliquez sur le lien ci-dessous pour choisir un nouveau mot de passe :</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>Ce lien expire dans 1 heure. Si ce n'est pas vous, ignorez cet e-mail.</p>
    `,
      text: `Bonjour ${name} !\n\nUne réinitialisation du mot de passe de votre compte a été demandée. Votre identifiant de connexion est ${username}.\n\nSi c'est bien vous, ouvrez le lien ci-dessous pour choisir un nouveau mot de passe :\n${resetUrl}\n\nCe lien expire dans 1 heure. Si ce n'est pas vous, ignorez cet e-mail.`,
    };
  }
  if (l === "en") {
    return {
      subject: `Reset your password — ${PRODUCT.en}`,
      html: `
      <p>Hi ${name}!</p>
      <p>A password reset was requested for your account. Your login username is <b>${username}</b>.</p>
      <p>If it was you, click the link below to choose a new password:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>This link expires in 1 hour. If it wasn't you, you can ignore this email.</p>
    `,
      text: `Hi ${name}!\n\nA password reset was requested for your account. Your login username is ${username}.\n\nIf it was you, open the link below to choose a new password:\n${resetUrl}\n\nThis link expires in 1 hour. If it wasn't you, you can ignore this email.`,
    };
  }
  return {
    subject: `Redefinir sua senha — ${PRODUCT["pt-BR"]}`,
    html: `
      <p>Oi, ${name}!</p>
      <p>Pediram a redefinição da senha da sua conta. Seu usuário de login é <b>${username}</b>.</p>
      <p>Se foi você quem pediu, clique no link abaixo pra escolher uma senha nova:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>Esse link expira em 1 hora. Se não foi você, pode ignorar este e-mail.</p>
    `,
    text: `Oi, ${name}!\n\nPediram a redefinição da senha da sua conta. Seu usuário de login é ${username}.\n\nSe foi você quem pediu, acesse o link abaixo pra escolher uma senha nova:\n${resetUrl}\n\nEsse link expira em 1 hora. Se não foi você, pode ignorar este e-mail.`,
  };
}

export function adminGeneratedPasswordEmail(locale: string, name: string, username: string, newPassword: string): EmailContent {
  const l: Locale = normalizeLocale(locale);
  if (l === "fr") {
    return {
      subject: `Votre mot de passe a été réinitialisé — ${PRODUCT.fr}`,
      html: `
      <p>Bonjour ${name} !</p>
      <p>Un administrateur de la plateforme a réinitialisé le mot de passe de votre compte. Votre identifiant de connexion est <b>${username}</b> et votre nouveau mot de passe est :</p>
      <p style="font-size: 18px; font-weight: 700; letter-spacing: 1px;">${newPassword}</p>
      <p>Nous vous recommandons de changer ce mot de passe dès votre connexion, via « Mot de passe oublié » sur l'écran de connexion.</p>
    `,
      text: `Bonjour ${name} !\n\nUn administrateur de la plateforme a réinitialisé le mot de passe de votre compte. Votre identifiant de connexion est ${username} et votre nouveau mot de passe est :\n${newPassword}\n\nNous vous recommandons de changer ce mot de passe dès votre connexion, via « Mot de passe oublié » sur l'écran de connexion.`,
    };
  }
  if (l === "en") {
    return {
      subject: `Your password has been reset — ${PRODUCT.en}`,
      html: `
      <p>Hi ${name}!</p>
      <p>A platform administrator reset your account password. Your login username is <b>${username}</b> and your new password is:</p>
      <p style="font-size: 18px; font-weight: 700; letter-spacing: 1px;">${newPassword}</p>
      <p>We recommend changing this password as soon as you sign in, using "Forgot my password" on the login screen.</p>
    `,
      text: `Hi ${name}!\n\nA platform administrator reset your account password. Your login username is ${username} and your new password is:\n${newPassword}\n\nWe recommend changing this password as soon as you sign in, using "Forgot my password" on the login screen.`,
    };
  }
  return {
    subject: `Sua senha foi redefinida — ${PRODUCT["pt-BR"]}`,
    html: `
      <p>Oi, ${name}!</p>
      <p>Um administrador da plataforma redefiniu a senha da sua conta. Seu usuário de login é <b>${username}</b> e sua nova senha de acesso é:</p>
      <p style="font-size: 18px; font-weight: 700; letter-spacing: 1px;">${newPassword}</p>
      <p>Recomendamos trocar essa senha assim que entrar, pela opção "Esqueci minha senha" na tela de login.</p>
    `,
    text: `Oi, ${name}!\n\nUm administrador da plataforma redefiniu a senha da sua conta. Seu usuário de login é ${username} e sua nova senha de acesso é:\n${newPassword}\n\nRecomendamos trocar essa senha assim que entrar, pela opção "Esqueci minha senha" na tela de login.`,
  };
}
