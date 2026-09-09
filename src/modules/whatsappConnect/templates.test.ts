import { describe, it, expect } from "vitest";
import { TEMPLATE_DEFINITIONS, validateTemplateDefinition, type TemplateDefinition } from "./templates.js";

// Trava a garantia pedida (09/09): nenhum template pode chegar na Meta sem
// "example"/variáveis bem formadas, pra nenhuma barbearia nova nem existente
// — a validação já roda sozinha na importação do módulo (derruba o boot se
// algo estiver errado), mas testar aqui documenta a intenção e evita
// depender só de alguém notar o app não subir.
describe("validateTemplateDefinition", () => {
  const base = (): TemplateDefinition => ({
    name: "teste_template",
    category: "UTILITY",
    bodyText: "Olá, {{1}}! Seu horário é {{2}}.",
    paramCount: 2,
    example: ["João", "15h"],
  });

  it("aceita um template bem formado (não lança)", () => {
    expect(() => validateTemplateDefinition(base())).not.toThrow();
  });

  it("todos os TEMPLATE_DEFINITIONS reais passam na validação", () => {
    for (const tpl of TEMPLATE_DEFINITIONS) {
      expect(() => validateTemplateDefinition(tpl)).not.toThrow();
    }
  });

  it("rejeita quando falta example pra alguma variável (causa real do INVALID_FORMAT de 09/09)", () => {
    const tpl = { ...base(), example: ["João"] };
    expect(() => validateTemplateDefinition(tpl)).toThrow(/example/i);
  });

  it("rejeita quando as variáveis não são sequenciais (pula número)", () => {
    const tpl = { ...base(), bodyText: "Olá, {{1}}! Seu horário é {{3}}.", paramCount: 2, example: ["João", "15h"] };
    expect(() => validateTemplateDefinition(tpl)).toThrow(/paramCount/i);
  });

  it("rejeita quando o corpo começa com uma variável (dangling parameter)", () => {
    const tpl = { ...base(), bodyText: "{{1}}, seu horário é {{2}}.", paramCount: 2, example: ["João", "15h"] };
    expect(() => validateTemplateDefinition(tpl)).toThrow(/começar nem terminar/i);
  });

  it("rejeita quando o corpo termina com uma variável (dangling parameter)", () => {
    const tpl = { ...base(), bodyText: "Olá {{1}}, seu horário é {{2}}", paramCount: 2, example: ["João", "15h"] };
    expect(() => validateTemplateDefinition(tpl)).toThrow(/começar nem terminar/i);
  });

  it("rejeita quando duas variáveis ficam coladas/adjacentes", () => {
    const tpl = { ...base(), bodyText: "Olá {{1}} {{2}} tudo bem?", paramCount: 2, example: ["João", "15h"] };
    expect(() => validateTemplateDefinition(tpl)).toThrow(/adjacentes/i);
  });
});
