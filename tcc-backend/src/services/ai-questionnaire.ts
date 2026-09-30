import { tool, type StructuredToolInterface, type ToolRuntime } from "@langchain/core/tools";
import { z } from "zod";
import type { AuthenticatedUser } from "./auth.js";

export type AiQuestionnaireChoice = {
  value: string;
  label: string;
  description?: string;
};

export type AiQuestionnaireQuestion = {
  name: string;
  prompt: string;
  description?: string;
  required: boolean;
  multiple: boolean;
  choices: AiQuestionnaireChoice[];
  allowOther: boolean;
  otherLabel: string;
  otherPlaceholder: string;
};

export type AiQuestionnaire = {
  title: string;
  questions: AiQuestionnaireQuestion[];
};

export type AiQuestionnaireProgressEvent = {
  type: "questionnaire";
  toolCallId: string;
  questionnaire: AiQuestionnaire;
};

const choiceSchema = z.object({
  value: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(160),
  description: z.string().trim().max(240).optional(),
}).strict();

const questionSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  prompt: z.string().trim().min(1).max(500),
  description: z.string().trim().max(500).optional(),
  required: z.boolean().default(true),
  multiple: z.boolean().default(false),
  choices: z.array(choiceSchema).max(8).default([]),
  allowOther: z.boolean().default(false),
  otherLabel: z.string().trim().min(1).max(80).default("Outra resposta"),
  otherPlaceholder: z.string().trim().min(1).max(160).default("Digite sua resposta"),
}).strict().superRefine((question, context) => {
  if (question.choices.length === 0 && !question.allowOther) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["choices"],
      message: "Informe opções ou permita uma resposta livre.",
    });
  }
  const values = new Set<string>();
  question.choices.forEach((choice, index) => {
    if (values.has(choice.value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["choices", index, "value"],
        message: "Os valores das opções precisam ser únicos.",
      });
    }
    values.add(choice.value);
  });
});

const questionnaireSchema = z.object({
  title: z.string().trim().min(1).max(160),
  questions: z.array(questionSchema).min(1).max(5),
}).strict().superRefine((input, context) => {
  const names = new Set<string>();
  input.questions.forEach((question, index) => {
    if (names.has(question.name)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["questions", index, "name"],
        message: "Os nomes das perguntas precisam ser únicos.",
      });
    }
    names.add(question.name);
  });
});

type RuntimeWithToolCallId = ToolRuntime & { toolCallId?: string };

export function createAiQuestionnaireTools(options: {
  currentUser: AuthenticatedUser;
  onQuestion: (event: AiQuestionnaireProgressEvent) => void | Promise<void>;
}): StructuredToolInterface[] {
  if (!options.currentUser.isAdmin) {
    throw new Error("Perguntas interativas estão disponíveis apenas para administradores.");
  }

  const askAdminQuestions = tool(async (questionnaire, runtime) => {
    const toolCallId = (runtime as RuntimeWithToolCallId).toolCallId ?? crypto.randomUUID();
    await options.onQuestion({
      type: "questionnaire",
      toolCallId,
      questionnaire,
    });
    return "As perguntas foram exibidas no chat. Aguarde a resposta do administrador e não continue o trabalho nesta rodada.";
  }, {
    name: "ask_admin_questions",
    description: "Mostra perguntas interativas ao administrador e encerra esta rodada. Use somente em tarefas da plataforma de dashboards quando faltar uma decisão de negócio indispensável, como a semântica inclusiva de uma data final ou qual dashboard existente alterar. Em perguntas analíticas diretas, não pergunte quantas linhas/grupos mostrar, formato de resposta, ou se deve salvar; mantenha todos os grupos e deixe o limite técnico da amostra explícito. Nunca use para pedidos fora da plataforma nem para perguntas respondíveis pelos dados disponíveis. Reúna perguntas indispensáveis em uma chamada com até cinco itens e aguarde a resposta antes de usar outras ferramentas.",
    schema: questionnaireSchema,
    returnDirect: true,
  });

  return [askAdminQuestions];
}
