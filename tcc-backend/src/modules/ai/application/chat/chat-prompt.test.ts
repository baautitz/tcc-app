import { describe, expect, it } from "vitest";
import { dashboardComponentTypes } from "../../../../shared/lib/contracts.js";
import { AiQuestionnaireTools } from "../ai-questionnaire.js";
import { buildSystemPrompt } from "./chat-prompt.js";

describe("prompt do sistema da IA", () => {
  const prompt = buildSystemPrompt(undefined);

  it("menciona todos os Tipos de componente do contrato", () => {
    for (const type of dashboardComponentTypes) {
      expect(prompt).toContain(type);
    }
  });

  it("exige respeitar o Tipo pedido e perguntar antes de trocar", () => {
    expect(prompt).toMatch(/Tipo pedido/);
    expect(prompt).toMatch(/nunca troque em silêncio/i);
  });

  it("exige o número exato de componentes pedido", () => {
    expect(prompt).toMatch(/exatamente o número de componentes pedido/);
  });

  it("trata Contexto vazio sem criar Proposta de contexto sozinha", () => {
    expect(prompt).toMatch(/Contexto de tabela\/coluna vazio/);
    expect(prompt).toMatch(/inferindo pelos nomes/);
    expect(prompt).toMatch(/não crie Proposta de contexto/i);
  });

  it("limita ask_admin_questions a uma chamada por fase e 4 perguntas", () => {
    expect(prompt).toMatch(/uma chamada por fase/);
    expect(prompt).toMatch(/no máximo 4 perguntas/);
    expect(prompt).toMatch(/cinco Tipos de componente reais/);
  });
});

describe("ask_admin_questions", () => {
  const [tool] = new AiQuestionnaireTools({
    currentUser: { isAdmin: true } as never,
    onQuestion: () => undefined,
  }).tools();
  const schema = (
    tool as unknown as {
      schema: { safeParse: (v: unknown) => { success: boolean } };
    }
  ).schema;
  const parse = (n: number) =>
    schema.safeParse({
      title: "T",
      questions: Array.from({ length: n }, (_, i) => ({
        name: `q${i}`,
        prompt: "Pergunta?",
        allowOther: true,
      })),
    }).success;

  it("aceita 4 perguntas e rejeita 5", () => {
    expect(parse(4)).toBe(true);
    expect(parse(5)).toBe(false);
  });
});
