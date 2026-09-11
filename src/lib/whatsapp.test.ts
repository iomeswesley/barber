import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

// Ver comentário em crypto.test.ts sobre por que o env é preenchido antes do
// import. Aqui o APP_SECRET é fixado (não `??=`) porque é justamente o
// insumo da assinatura que estamos verificando.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.DIRECT_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.NODE_ENV = "test";
process.env.WHATSAPP_APP_SECRET = "app-secret-de-teste";
process.env.WHATSAPP_ACCESS_TOKEN = "token-global-de-teste";

const { verifyWebhookSignature, resolveBarbershopAccessToken, isWhatsappDisconnectionError, downloadWhatsappMedia, sendWhatsappMedia } =
  await import("./whatsapp.js");

function sign(body: Buffer, secret = "app-secret-de-teste"): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("verifyWebhookSignature", () => {
  const body = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));

  it("aceita a assinatura correta do corpo cru", () => {
    expect(verifyWebhookSignature(body, sign(body))).toBe(true);
  });

  it("rejeita assinatura gerada com outro app secret", () => {
    expect(verifyWebhookSignature(body, sign(body, "secret-do-atacante"))).toBe(false);
  });

  // O ponto do "corpo cru": se o body for re-serializado em algum ponto do
  // pipeline (JSON.parse + stringify), o HMAC deixa de bater. Este teste
  // trava esse contrato — assinatura válida pra OUTRO corpo não passa.
  it("rejeita assinatura válida de um corpo diferente", () => {
    const outro = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "1" }] }));
    expect(verifyWebhookSignature(body, sign(outro))).toBe(false);
  });

  it("rejeita header ausente, vazio ou sem o prefixo sha256=", () => {
    expect(verifyWebhookSignature(body, undefined)).toBe(false);
    expect(verifyWebhookSignature(body, "")).toBe(false);
    expect(verifyWebhookSignature(body, crypto.createHmac("sha256", "app-secret-de-teste").update(body).digest("hex"))).toBe(false);
    expect(verifyWebhookSignature(body, "sha1=abc")).toBe(false);
  });

  // timingSafeEqual lança se os buffers tiverem tamanhos diferentes — o
  // guard de comprimento tem que devolver false antes de chegar lá, senão
  // um header truncado vira 500 em vez de 401.
  it("rejeita (sem lançar) assinatura de comprimento diferente do esperado", () => {
    expect(() => verifyWebhookSignature(body, "sha256=abc")).not.toThrow();
    expect(verifyWebhookSignature(body, "sha256=abc")).toBe(false);
  });
});

describe("resolveBarbershopAccessToken", () => {
  it("volta undefined quando a barbearia não conectou o próprio número", () => {
    expect(resolveBarbershopAccessToken(null)).toBeUndefined();
    expect(resolveBarbershopAccessToken(undefined)).toBeUndefined();
    expect(resolveBarbershopAccessToken({ whatsappAccessTokenEnc: null })).toBeUndefined();
  });

  // Falha de descriptografia (chave rotacionada, valor corrompido) tem que
  // cair pro token global em vez de derrubar o envio.
  it("volta undefined em vez de lançar quando o valor gravado não descriptografa", () => {
    expect(resolveBarbershopAccessToken({ whatsappAccessTokenEnc: "nao-e-um-payload-valido" })).toBeUndefined();
  });
});

// Achado em produção (2026-09-07): dono desconectou o Coexistence pelo
// celular, token continuou salvo mas perdeu acesso à WABA — confirmado numa
// chamada de leitura direta na Meta, que voltou exatamente o corpo abaixo.
describe("isWhatsappDisconnectionError", () => {
  it("reconhece o erro real capturado em produção (code 100 + error_subcode 33)", () => {
    const body = JSON.stringify({
      error: {
        message: "Unsupported get request. Object with ID '123' does not exist, cannot be loaded due to missing permissions...",
        type: "GraphMethodException",
        code: 100,
        error_subcode: 33,
        fbtrace_id: "abc",
      },
    });
    const err = new Error(`Falha ao enviar mensagem WhatsApp (400): ${body}`);
    expect(isWhatsappDisconnectionError(err)).toBe(true);
  });

  it("reconhece token inválido/expirado (code 190)", () => {
    const err = new Error(`Falha ao enviar mensagem WhatsApp (401): {"error":{"code":190,"message":"Invalid OAuth access token"}}`);
    expect(isWhatsappDisconnectionError(err)).toBe(true);
  });

  it("NÃO reconhece erro de negócio comum (ex: destinatário inválido) como desconexão", () => {
    const err = new Error(
      `Falha ao enviar mensagem WhatsApp (400): {"error":{"code":131030,"message":"Recipient phone number not in allowed list"}}`
    );
    expect(isWhatsappDisconnectionError(err)).toBe(false);
  });

  it("NÃO reconhece code 100 sozinho, sem error_subcode 33 (é genérico demais)", () => {
    const err = new Error(`Falha ao enviar mensagem WhatsApp (400): {"error":{"code":100,"message":"Invalid parameter"}}`);
    expect(isWhatsappDisconnectionError(err)).toBe(false);
  });

  it("volta false pra algo que não é um Error", () => {
    expect(isWhatsappDisconnectionError("string qualquer")).toBe(false);
    expect(isWhatsappDisconnectionError(null)).toBe(false);
    expect(isWhatsappDisconnectionError(undefined)).toBe(false);
  });
});

// Caminho inverso de uploadWhatsappMedia — usado pra baixar mensagem de voz
// recebida e mandar pra transcrição (ver src/lib/transcription.ts).
describe("downloadWhatsappMedia", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolve a URL temporária a partir do media id, depois baixa os bytes de lá — os dois passos com o Bearer token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://lookaside.fbsbx.com/temp/abc", mime_type: "audio/ogg; codecs=opus" }) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new TextEncoder().encode("bytes-do-audio").buffer });
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadWhatsappMedia("media-id-1", "token-da-barbearia");

    expect(result.mimeType).toBe("audio/ogg; codecs=opus");
    expect(result.buffer.toString()).toBe("bytes-do-audio");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toEqual({ Authorization: "Bearer token-da-barbearia" });
    expect(fetchMock.mock.calls[1]![0]).toBe("https://lookaside.fbsbx.com/temp/abc");
    expect((fetchMock.mock.calls[1]![1] as RequestInit).headers).toEqual({ Authorization: "Bearer token-da-barbearia" });
  });

  it("lança quando a Meta não devolve URL nenhuma", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadWhatsappMedia("media-id-2")).rejects.toThrow(/não trouxe a URL/i);
  });

  it("lança quando o primeiro passo (resolver a URL) falha", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 404, text: async () => "not found" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadWhatsappMedia("media-id-3")).rejects.toThrow(/Falha ao resolver URL/i);
  });
});

// image/video/audio viram o tipo de mensagem nativo correspondente (preview/
// player no WhatsApp do cliente); qualquer outro mime type vira "document".
describe("sendWhatsappMedia (classificação por mime type)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function sendAndCaptureBody(mimeType: string) {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    await sendWhatsappMedia("phone-id", "5511999990000", "media-id", mimeType, "arquivo", "token");
    return JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
  }

  it("image/* vira type: image, sem filename", async () => {
    const body = await sendAndCaptureBody("image/jpeg");
    expect(body.type).toBe("image");
    expect(body.image).toEqual({ id: "media-id" });
  });

  it("video/* vira type: video, sem filename", async () => {
    const body = await sendAndCaptureBody("video/mp4");
    expect(body.type).toBe("video");
    expect(body.video).toEqual({ id: "media-id" });
  });

  it("audio/* vira type: audio, sem filename (a Cloud API rejeita esse campo pra áudio)", async () => {
    const body = await sendAndCaptureBody("audio/ogg");
    expect(body.type).toBe("audio");
    expect(body.audio).toEqual({ id: "media-id" });
  });

  it("qualquer outro mime type vira type: document, com filename", async () => {
    const body = await sendAndCaptureBody("application/pdf");
    expect(body.type).toBe("document");
    expect(body.document).toEqual({ id: "media-id", filename: "arquivo" });
  });
});
