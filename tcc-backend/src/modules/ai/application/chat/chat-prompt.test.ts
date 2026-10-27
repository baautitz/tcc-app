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

  it("descreve as 5 fases e que o backend as impõe", () => {
    expect(prompt).toMatch(/# Fases do dashboard/);
    for (const phase of [
      /1\. Entendimento/,
      /2\. Query/,
      /3\. Componente isolado/,
      /4\. Posição/,
      /5\. Proposta de dashboard/,
    ])
      expect(prompt).toMatch(phase);
    expect(prompt).toMatch(/preview_component/);
    expect(prompt).toMatch(/Aprovar/);
    expect(prompt).toMatch(/Pedir ajuste/);
    expect(prompt).toMatch(/o backend recusa/i);
  });

  it("permite pular as fases 1, 2 e 4, nunca a 3, e nunca assumir o fim", () => {
    expect(prompt).toMatch(/fases 1, 2 e 4 podem ser puladas/);
    expect(prompt).toMatch(/fase 3 nunca é pulada/);
    expect(prompt).toMatch(/nunca assuma o fim/i);
  });

  it("no contexto de um dashboard o destino vale, mas a posição não", () => {
    expect(prompt).toMatch(/contexto de navegação.*destino.*posição/i);
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

  it("sempre permite resposta livre, mesmo com opções e allowOther=false", async () => {
    const events: unknown[] = [];
    const [questionTool] = new AiQuestionnaireTools({
      currentUser: { isAdmin: true } as never,
      onQuestion: (event) => void events.push(event),
    }).tools();
    await questionTool!.invoke({
      title: "T",
      questions: [
        {
          name: "posicao",
          prompt: "Onde?",
          allowOther: false,
          choices: [{ value: "fim", label: "No final" }],
        },
        { name: "livre", prompt: "Como?" },
      ],
    });
    const [event] = events as {
      questionnaire: { questions: { allowOther: boolean }[] };
    }[];
    expect(event!.questionnaire.questions.map((q) => q.allowOther)).toEqual([
      true,
      true,
    ]);
  });
});
