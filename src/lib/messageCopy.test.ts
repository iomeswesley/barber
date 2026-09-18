import { describe, it, expect } from "vitest";
import { rescheduleNoticeText, comeBackHint, comeBackText, reminderText, botNotice } from "./messageCopy.js";
import { verificationEmail, passwordResetEmail, adminGeneratedPasswordEmail } from "./emailCopy.js";
import type { AppointmentDTO } from "@/modules/appointments/appointments.types.js";

const appt = {
  id: 1,
  clientName: "Jean",
  serviceName: "Coupe",
  barberName: "Marc",
  barbershopName: "Vintage",
  startTime: "15:00",
  date: "2026-09-20",
} as AppointmentDTO;

describe("messageCopy", () => {
  it("pt-BR (padrão) mantém o texto histórico", () => {
    expect(rescheduleNoticeText("pt-BR", appt)).toContain("Precisamos remarcar seu horário de Coupe com Marc às 15:00 no dia 2026-09-20");
    expect(rescheduleNoticeText("qualquer-coisa", appt)).toBe(rescheduleNoticeText("pt-BR", appt));
    expect(reminderText("pt-BR", appt, "https://x/c", "💈")).toContain("Confirme sua presença: https://x/c");
  });

  it("fr e en traduzem o texto e mantêm os mesmos dados", () => {
    expect(rescheduleNoticeText("fr", appt)).toContain("Bonjour Jean");
    expect(rescheduleNoticeText("fr", appt)).toContain("15:00");
    expect(rescheduleNoticeText("en", appt)).toContain("Hi Jean");
    expect(reminderText("fr", appt, "https://x/c", "💈")).toContain("Confirmez votre présence : https://x/c");
    expect(reminderText("en", appt, "https://x/c", "💈")).toContain("Please confirm you're coming: https://x/c");
  });

  it("o hint de reconquista (parâmetro {{3}} do template) segue o idioma do template", () => {
    expect(comeBackHint("fr", null)).toContain("créneau");
    expect(comeBackHint("en", appt)).toContain("Coupe");
    expect(comeBackHint("pt-BR", appt)).toContain("Que tal já garantir um novo Coupe com Marc");
    expect(comeBackText("fr", "Jean", "Vintage", null, "💈")).toContain("chez Vintage");
  });

  it("avisos fixos do bot existem nos 3 idiomas e caem em pt-BR se o idioma for desconhecido", () => {
    const keys = ["billingBlocked", "repeat", "problem", "audioNotUnderstood", "textOnly", "textOrAudioOnly"] as const;
    for (const k of keys) {
      for (const l of ["pt-BR", "fr", "en"]) expect(botNotice(l, k).length).toBeGreaterThan(5);
      expect(botNotice("de", k)).toBe(botNotice("pt-BR", k));
      expect(botNotice(null, k)).toBe(botNotice("pt-BR", k));
    }
    expect(botNotice("fr", "repeat")).toBe("Désolé, pouvez-vous répéter ?");
  });
});

describe("emailCopy", () => {
  it("cada e-mail tem assunto, html e texto puro nos 3 idiomas, com o link", () => {
    for (const l of ["pt-BR", "fr", "en"]) {
      for (const mail of [verificationEmail(l, "Ana", "https://x/v"), passwordResetEmail(l, "Ana", "ana", "https://x/r")]) {
        expect(mail.subject.length).toBeGreaterThan(5);
        expect(mail.html).toContain("https://x/");
        expect(mail.text).toContain("https://x/");
      }
      const admin = adminGeneratedPasswordEmail(l, "Ana", "ana", "S3nh4!");
      expect(admin.html).toContain("S3nh4!");
      expect(admin.text).toContain("S3nh4!");
    }
  });

  it("pt-BR mantém o assunto histórico", () => {
    expect(verificationEmail("pt-BR", "Ana", "u").subject).toBe("Confirme seu e-mail — Painel da Barbearia");
    expect(verificationEmail("fr", "Ana", "u").subject).toContain("Confirmez votre e-mail");
  });
});
