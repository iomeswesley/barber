import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.DIRECT_URL ??= "postgresql://user:pass@localhost:5432/db";
process.env.SESSION_SECRET ??= "test-session-secret";

// Achado em produção (10/09): RESEND_API_KEY/PLATFORM_ALERT_EMAIL estão
// configurados neste ambiente (mesmas credenciais de produção) — sem
// mockar isso, os testes de markWhatsappDisconnectedIfNeeded/
// markWhatsappReconnectedIfNeeded abaixo mandavam e-mail de alerta REAL a
// cada `vitest run` (3 e-mails reais chegaram na caixa do usuário antes
// desse fix). alerts.ts não tem (nem deve ter) um kill-switch global de
// teste — alerts.test.ts mocka o SDK do Resend de propósito pra validar o
// envio de verdade quando configurado; o jeito certo de isolar ESTE
// arquivo é mockar alertPlatformOperator aqui, não desligar a função pra
// todo mundo.
const alertPlatformOperatorMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/alerts.js", () => ({ alertPlatformOperator: alertPlatformOperatorMock }));

const { createTemplates, markWhatsappDisconnectedIfNeeded, markWhatsappReconnectedIfNeeded } = await import("./whatsappConnect.service.js");
const { TEMPLATE_DEFINITIONS } = await import("./templates.js");
const { prisma } = await import("@/lib/prisma.js");

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

// Achado em produção (10/09, Vintage): um bug à parte (token errado em
// chatEngine.sendManualMessage) fez markWhatsappDisconnectedIfNeeded marcar
// uma barbearia com WhatsApp funcionando normalmente como "disconnected" —
// e nada revertia isso sozinho depois. markWhatsappReconnectedIfNeeded é a
// contrapartida: chamada depois de qualquer envio bem-sucedido, corrige o
// status sozinho na próxima mensagem que realmente for.
describe("markWhatsappDisconnectedIfNeeded / markWhatsappReconnectedIfNeeded", () => {
  const createdBusinessIds: number[] = [];

  afterAll(async () => {
    await prisma.business.deleteMany({ where: { id: { in: createdBusinessIds } } });
  });

  beforeEach(() => {
    alertPlatformOperatorMock.mockClear();
  });

  async function createTestBusiness(status: string) {
    const biz = await prisma.business.create({
      data: { name: `[teste] WhatsApp reconnect ${Date.now()}`, whatsappConnectionStatus: status },
    });
    createdBusinessIds.push(biz.id);
    return biz;
  }

  it("marca disconnected só num erro que indica queda real (código 190/100+33)", async () => {
    const biz = await createTestBusiness("connected");
    await markWhatsappDisconnectedIfNeeded(biz.id, new Error('{"error":{"code":190}}'));
    const after = await prisma.business.findUnique({ where: { id: biz.id } });
    expect(after?.whatsappConnectionStatus).toBe("disconnected");
    // Prova de que o alerta passou pelo mock (nunca pelo Resend de verdade)
    // — é exatamente essa chamada que mandava e-mail real antes do fix.
    expect(alertPlatformOperatorMock).toHaveBeenCalledTimes(1);
  });

  it("não mexe no status pra um erro qualquer (ex: rede, rate limit)", async () => {
    const biz = await createTestBusiness("connected");
    await markWhatsappDisconnectedIfNeeded(biz.id, new Error("timeout de rede"));
    const after = await prisma.business.findUnique({ where: { id: biz.id } });
    expect(after?.whatsappConnectionStatus).toBe("connected");
  });

  it("reverte disconnected pra connected depois de um envio bem-sucedido", async () => {
    const biz = await createTestBusiness("disconnected");
    await markWhatsappReconnectedIfNeeded(biz.id);
    const after = await prisma.business.findUnique({ where: { id: biz.id } });
    expect(after?.whatsappConnectionStatus).toBe("connected");
    expect(alertPlatformOperatorMock).toHaveBeenCalledTimes(1);
  });

  it("não mexe se o status já não era disconnected (ex: pending_templates)", async () => {
    const biz = await createTestBusiness("pending_templates");
    await markWhatsappReconnectedIfNeeded(biz.id);
    const after = await prisma.business.findUnique({ where: { id: biz.id } });
    expect(after?.whatsappConnectionStatus).toBe("pending_templates");
  });
});
