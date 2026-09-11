import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Ver comentário em crypto.test.ts sobre por que o env é preenchido antes do
// import.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.DIRECT_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.GROQ_API_KEY = "groq-key-de-teste";

const { transcribeAudio, transcriptionConfigured } = await import("./transcription.js");

describe("transcriptionConfigured", () => {
  it("true quando GROQ_API_KEY está configurada (mesmo ambiente deste arquivo)", () => {
    expect(transcriptionConfigured).toBe(true);
  });
});

describe("transcribeAudio", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("manda o áudio pro Groq (multipart, whisper-large-v3-turbo) e devolve o texto transcrito", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: "quero marcar um corte amanhã" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeAudio(Buffer.from("fake-audio-bytes"), "audio/ogg");

    expect(result).toBe("quero marcar um corte amanhã");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer groq-key-de-teste");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("devolve null (não lança) quando a Groq responde erro", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "invalid api key" });
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeAudio(Buffer.from("fake-audio-bytes"), "audio/ogg");

    expect(result).toBeNull();
  });

  it("devolve null quando a transcrição vem vazia (áudio silencioso/corrompido)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: "   " }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeAudio(Buffer.from("fake-audio-bytes"), "audio/ogg");

    expect(result).toBeNull();
  });

  it("devolve null (não lança) numa falha de rede", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("timeout de rede"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeAudio(Buffer.from("fake-audio-bytes"), "audio/ogg");

    expect(result).toBeNull();
  });
});
