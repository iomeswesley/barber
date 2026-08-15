import { describe, it, expect } from "vitest";
import { loadVertical } from "./index.js";

describe("loadVertical", () => {
  it("resolve o vocabulário do odonto corretamente", () => {
    const v = loadVertical("odonto");
    expect(v.professional).toBe("dentista");
    expect(v.professionalPlural).toBe("dentistas");
    expect(v.client).toBe("paciente");
    expect(v.business).toBe("clínica");
    expect(v.service).toBe("procedimento");
    expect(v.brandIcon).toBe("brand-tooth");
  });

  it("resolve o vocabulário do barbearia corretamente", () => {
    const v = loadVertical("barbearia");
    expect(v.professional).toBe("barbeiro");
    expect(v.professionalPlural).toBe("barbeiros");
    expect(v.client).toBe("cliente");
    expect(v.business).toBe("barbearia");
    expect(v.service).toBe("serviço");
    expect(v.brandIcon).toBe("brand-razor");
  });

  it("lança erro claro pra vertical desconhecido", () => {
    expect(() => loadVertical("salao-de-beleza")).toThrow(/desconhecido/);
  });
});
