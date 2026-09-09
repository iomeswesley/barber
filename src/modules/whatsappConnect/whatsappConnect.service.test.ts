import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.DIRECT_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.SESSION_SECRET ??= "test-session-secret";

const { createTemplates } = await import("./whatsappConnect.service.js");
const { TEMPLATE_DEFINITIONS } = await import("./templates.js");

// Garantia pedida pelo usuário (09/09): toda barbearia que conectar a partir
// de agora precisa mandar pra Meta um payload que passe na validação de
// formato — não só confiar na inspeção visual do código. Mocka fetch global
// (nenhuma chamada de rede de verdade) e confere o body de cada POST.
describe("createTemplates (payload real mandado pra Meta)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("manda example.body_text com o mesmo tamanho de paramCount pra cada template de texto livre", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}), text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);

    await createTemplates("waba-teste", "token-teste");

    // Uma chamada por template em TEMPLATE_DEFINITIONS + 1 pro OTP.
    expect(fetchMock).toHaveBeenCalledTimes(TEMPLATE_DEFINITIONS.length + 1);

    for (const tpl of TEMPLATE_DEFINITIONS) {
      const call = fetchMock.mock.calls.find(([url, init]) => {
        const body = JSON.parse((init as RequestInit).body as string);
        return body.name === tpl.name;
      });
      expect(call, `chamada pro template "${tpl.name}" não encontrada`).toBeTruthy();
      const [url, init] = call!;
      expect(url).toBe(`https://graph.facebook.com/v21.0/waba-teste/message_templates`);
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.category).toBe(tpl.category);
      expect(body.components).toEqual([{ type: "BODY", text: tpl.bodyText, example: { body_text: [tpl.example] } }]);
      // A checagem que realmente evita o INVALID_FORMAT: um valor de
      // exemplo pra cada {{n}} do corpo, nem a mais nem a menos.
      expect(body.components[0].example.body_text[0]).toHaveLength(tpl.paramCount);
    }

    vi.unstubAllGlobals();
  });

  it("template come_back_message vai como MARKETING (não UTILITY) — a Meta reclassifica e rejeita se divergir", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}), text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);

    await createTemplates("waba-teste", "token-teste");

    const call = fetchMock.mock.calls.find(([, init]) => JSON.parse((init as RequestInit).body as string).name === "come_back_message");
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.category).toBe("MARKETING");

    vi.unstubAllGlobals();
  });
});
