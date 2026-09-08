import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.DIRECT_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.SESSION_SECRET ??= "test-session-secret";

const sendMock = vi.fn().mockResolvedValue({ data: { id: "email-1" }, error: null });
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}));

describe("alertPlatformOperator", () => {
  beforeEach(() => {
    sendMock.mockClear();
    vi.resetModules();
  });

  // Sem PLATFORM_ALERT_EMAIL configurado, é o comportamento padrão do
  // projeto (mesmo stub de RESEND_API_KEY/WhatsApp não configurado) — nunca
  // pode travar o fluxo que estava tentando alertar sobre outra coisa.
  it("não lança e não chama o Resend quando PLATFORM_ALERT_EMAIL não está configurado", async () => {
    delete process.env.PLATFORM_ALERT_EMAIL;
    process.env.RESEND_API_KEY = "re_teste";
    const { alertPlatformOperator } = await import("./alerts.js");
    await expect(alertPlatformOperator("Assunto", "Mensagem")).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("manda o e-mail quando configurado, com o assunto prefixado", async () => {
    process.env.PLATFORM_ALERT_EMAIL = "admin@exemplo.com";
    process.env.RESEND_API_KEY = "re_teste";
    const { alertPlatformOperator } = await import("./alerts.js");
    await alertPlatformOperator("WhatsApp desconectado", "Detalhe do problema");
    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0]![0];
    expect(call.to).toBe("admin@exemplo.com");
    expect(call.subject).toBe("[Alerta] WhatsApp desconectado");
    expect(call.html).toContain("Detalhe do problema");
  });

  // O Resend não lança em erro da API — devolve {error} e resolve normal
  // (mesmo padrão já documentado em sendVerificationEmail, email.ts). Sem
  // checar isso, uma falha de envio passaria sem log nenhum.
  it("não lança quando o Resend devolve {error} em vez de lançar", async () => {
    process.env.PLATFORM_ALERT_EMAIL = "admin@exemplo.com";
    process.env.RESEND_API_KEY = "re_teste";
    sendMock.mockResolvedValueOnce({ data: null, error: { message: "domínio não verificado" } });
    const { alertPlatformOperator } = await import("./alerts.js");
    await expect(alertPlatformOperator("Assunto", "Mensagem")).resolves.toBeUndefined();
  });
});
