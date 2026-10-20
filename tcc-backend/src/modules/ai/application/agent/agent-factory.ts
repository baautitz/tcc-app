import { createAgent } from "langchain";
import { createMiddleware } from "langchain";
import {
  AIMessage,
  RemoveMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { REMOVE_ALL_MESSAGES } from "@langchain/langgraph";
import {
  aiCheckpointer,
  type AiCheckpointer,
} from "../../infrastructure/checkpointer.js";
import type { AIMessageChunk } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import {
  aiConfigService,
  type AiConfigService,
  type ResolvedAiConfiguration,
} from "./agent-model-config.js";
import {
  clearPendingResponse,
  dashboardPreflightIssue,
  hasActionCardResult,
  hasUnresolvedTestQueryCall,
  latestQueryTestResult,
  missingEmptyPreviewAnalysis,
  queryPreflightIssue,
} from "./agent-preflight.js";

// Middleware hooks add graph steps around each model/tool cycle; leave room for
// staged schema analysis, bounded query retries, and the final QA pass.
export const AI_AGENT_RECURSION_LIMIT = 96;

type AnyMessage = {
  type?: string;
  id?: string;
  tool_calls?: Array<{ id?: string; name: string }>;
  tool_call_id?: string;
  content?: unknown;
};

function lastHumanIndex(messages: readonly { type?: string }[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1)
    if (messages[index]?.type === "human") return index;
  return -1;
}

/** Messages of the run in progress: the checkpointer keeps older turns, but the QA hooks must only judge this one. */
export function currentTurn<T extends { type?: string }>(
  messages: readonly T[],
): T[] {
  const start = lastHumanIndex(messages);
  return start < 0 ? [...messages] : messages.slice(start);
}

const STALE_TOOL_RESULT_CHARS = 1_500;
const HISTORY_SOFT_LIMIT = 80;
const HISTORY_KEEP = 50;

/**
 * Keeps the persisted thread valid and small: answers dangling tool calls (a run stopped right after a
 * card was emitted), shrinks tool results of earlier turns and drops the oldest turns.
 */
export function repairThreadMessages(
  messages: readonly AnyMessage[],
): AnyMessage[] | undefined {
  const turnStart = lastHumanIndex(messages);
  let changed = false;
  let result: AnyMessage[] = [];
  const answered = new Set(
    messages.flatMap((message) =>
      message.type === "tool" && message.tool_call_id
        ? [message.tool_call_id]
        : [],
    ),
  );
  messages.forEach((message, index) => {
    let next = message;
    if (
      message.type === "tool" &&
      index < turnStart &&
      typeof message.content === "string" &&
      message.content.length > STALE_TOOL_RESULT_CHARS
    ) {
      next = {
        ...message,
        content: `${message.content.slice(0, STALE_TOOL_RESULT_CHARS)}… [resultado antigo truncado]`,
      };
      changed = true;
    }
    result.push(next);
    if (message.type !== "ai") return;
    for (const call of message.tool_calls ?? []) {
      if (!call.id || answered.has(call.id)) continue;
      result.push({
        type: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(
          call.name === "create_or_update_dashboard"
            ? {
                ok: true,
                message:
                  "Prévia já exibida ao administrador; aguarde a decisão dele no cartão.",
              }
            : {
                ok: false,
                message: "Execução interrompida antes do resultado.",
              },
        ),
        name: call.name,
      } as AnyMessage);
      changed = true;
    }
  });
  if (result.length > HISTORY_SOFT_LIMIT) {
    const cut = result.findIndex(
      (message, index) =>
        index >= result.length - HISTORY_KEEP && message.type === "human",
    );
    if (cut > 0) {
      result = result.slice(cut);
      changed = true;
    }
  }
  return changed ? result : undefined;
}

export const threadMaintenance = createMiddleware({
  name: "thread_maintenance",
  stateSchema: z.object({
    emptyResponseRetries: z.number().default(0),
    zeroRowsReviewRetries: z.number().default(0),
    queryResultReviewRetries: z.number().default(0),
    queryUpdateRetries: z.number().default(0),
    dashboardProposalRetries: z.number().default(0),
  }),
  beforeAgent: (state) => {
    // Retry counters are per turn; the thread persists them otherwise.
    const reset = {
      emptyResponseRetries: 0,
      zeroRowsReviewRetries: 0,
      queryResultReviewRetries: 0,
      queryUpdateRetries: 0,
      dashboardProposalRetries: 0,
    };
    const repaired = repairThreadMessages(
      state.messages as unknown as AnyMessage[],
    );
    if (!repaired) return reset;
    return {
      ...reset,
      messages: [
        new RemoveMessage({ id: REMOVE_ALL_MESSAGES }),
        ...(repaired as never[]),
      ],
    };
  },
});

const finalResponseQa = createMiddleware({
  name: "final_response_qa",
  stateSchema: z.object({
    emptyResponseRetries: z.number().default(0),
    zeroRowsReviewRetries: z.number().default(0),
    queryResultReviewRetries: z.number().default(0),
    queryUpdateRetries: z.number().default(0),
    dashboardProposalRetries: z.number().default(0),
  }),
  wrapToolCall: async (request, handler) => {
    if (
      request.toolCall.name !== "test_query" &&
      hasUnresolvedTestQueryCall(currentTurn(request.state.messages))
    ) {
      return new ToolMessage({
        content: JSON.stringify({
          ok: false,
          code: "QUERY_APPROVAL_REQUIRED",
          message:
            "A prévia da query precisa ser aprovada antes das próximas ações.",
          instruction:
            "Encerre esta rodada e aguarde a confirmação explícita do administrador no cartão da prévia. Só continue usando o UUID depois que a query for salva; nunca use testRunId como queryUuid.",
        }),
        tool_call_id: request.toolCall.id ?? crypto.randomUUID(),
        name: request.toolCall.name,
      });
    }
    if (request.toolCall.name === "create_or_update_dashboard") {
      const issue = dashboardPreflightIssue(
        currentTurn(request.state.messages),
        request.toolCall.args,
        request.runtime.context,
      );
      if (issue) {
        clearPendingResponse(request.runtime.context);
        return new ToolMessage({
          content: JSON.stringify({
            ok: false,
            code: "DASHBOARD_CONTEXT_REQUIRED",
            message: issue,
            instruction:
              "Não aplique o patch ainda. Leia o dashboard alvo com get_current_dashboard, use os filtros e bindings retornados, preserve os componentes não mencionados e só então tente novamente.",
          }),
          tool_call_id: request.toolCall.id ?? crypto.randomUUID(),
          name: request.toolCall.name,
        });
      }
    }
    if (request.toolCall.name !== "test_query") return handler(request);
    const issue = queryPreflightIssue(
      currentTurn(request.state.messages),
      request.toolCall.args,
      request.runtime.context,
    );
    if (!issue) return handler(request);
    clearPendingResponse(request.runtime.context);
    return new ToolMessage({
      content: JSON.stringify({
        ok: false,
        code: "QUERY_PREFLIGHT_REQUIRED",
        retryable: false,
        askUser: false,
        message: issue,
        instruction: issue.includes("purpose='dashboard'")
          ? "A query ainda não foi executada. Repita test_query com os mesmos SQL, parâmetros e valores, corrigindo purpose para dashboard. O pedido de adicionar o componente continua pendente."
          : issue.includes("NULL/lista vazia")
            ? "Corrija o SQL para preservar required=false e fazer seleção ausente, NULL ou array vazio significar ausência do filtro. Use COALESCE(CARDINALITY(array), 0) = 0 OR coluna = ANY(array); depois execute test_query novamente."
            : "Não execute SQL ainda. Complete a etapa de análise indicada usando as ferramentas de leitura; depois reavalie a query e tente uma vez com SQL fundamentado no catálogo.",
      }),
      tool_call_id: request.toolCall.id ?? crypto.randomUUID(),
      name: "test_query",
    });
  },
  beforeModel: {
    hook: (state) => {
      const latestTest = latestQueryTestResult(currentTurn(state.messages));
      if (latestTest?.ok === true && Number(latestTest.rowCount) > 0) {
        return { jumpTo: "end" as const };
      }
    },
    canJumpTo: ["end"],
  },
  afterModel: {
    hook: (state, runtime) => {
      const lastMessage = state.messages.at(-1);
      if (!lastMessage || lastMessage.type !== "ai") return;
      const toolCalls =
        "tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls)
          ? lastMessage.tool_calls
          : [];

      const missingEmptyAnalysis = missingEmptyPreviewAnalysis(
        currentTurn(state.messages),
      );
      if (
        (missingEmptyAnalysis.date || missingEmptyAnalysis.dimensions) &&
        state.zeroRowsReviewRetries < 2
      ) {
        const onlyAnalysisCalls =
          toolCalls.length > 0 &&
          toolCalls.every(
            (call) =>
              call.name === "analyze_date_coverage" ||
              call.name === "analyze_column_values",
          );
        if (onlyAnalysisCalls) return;
        if (!lastMessage.id) return;
        clearPendingResponse(runtime.context);
        const requiredAnalyses = [
          ...(missingEmptyAnalysis.date
            ? ["analyze_date_coverage na coluna temporal usada pela query"]
            : []),
          ...(missingEmptyAnalysis.dimensions
            ? [
                "analyze_column_values na dimensão ligada ao filtro multi_select",
              ]
            : []),
        ].join(" e ");
        return {
          messages: [
            new RemoveMessage({ id: lastMessage.id }),
            new SystemMessage(
              `Revisão de dados obrigatória: test_query retornou zero linhas. Antes de responder ou testar outra variante, faça ${requiredAnalyses} na mesma fonte e em uma tabela usada pela query; compare os resultados com os filtros informados. Depois explique a causa provável ou faça um refinamento fundamentado. Não pergunte se o administrador quer salvar uma amostra vazia.`,
            ),
          ],
          zeroRowsReviewRetries: state.zeroRowsReviewRetries + 1,
          jumpTo: "model" as const,
        };
      }
      if (toolCalls.length > 0) return;

      const content0 = lastMessage.content;
      const claimText = (typeof content0 === "string" ? content0 : "").replace(
        /<think>[\s\S]*?<\/think>/gi,
        "",
      );
      // The model must never announce a card/proposal that no tool produced in this turn.
      const claimsCard =
        /pronta para revis|aplicar altera|no cart[aã]o|cart[aã]o de pr[eé]via/i.test(
          claimText,
        );
      if (
        claimsCard &&
        !hasActionCardResult(currentTurn(state.messages)) &&
        lastMessage.id
      ) {
        clearPendingResponse(runtime.context);
        if (state.dashboardProposalRetries < 1) {
          return {
            messages: [
              new RemoveMessage({ id: lastMessage.id }),
              new SystemMessage(
                "Você anunciou uma prévia ou cartão, mas nenhuma ferramenta o produziu nesta rodada. Chame a ferramenta adequada (create_or_update_dashboard, test_query ou ask_admin_questions) antes de responder; se ela falhar, diga que nada foi gerado nem alterado.",
              ),
            ],
            dashboardProposalRetries: state.dashboardProposalRetries + 1,
            jumpTo: "model" as const,
          };
        }
        return {
          messages: [
            new RemoveMessage({ id: lastMessage.id }),
            new AIMessage({
              content:
                "Não consegui gerar o cartão de prévia nesta rodada. Nada foi alterado; tente novamente.",
            }),
          ],
        };
      }

      const latestTest = latestQueryTestResult(currentTurn(state.messages));
      const content = lastMessage.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .flatMap((part) =>
                  part &&
                  typeof part === "object" &&
                  "type" in part &&
                  part.type === "text" &&
                  "text" in part &&
                  typeof part.text === "string"
                    ? [part.text]
                    : [],
                )
                .join("")
            : "";
      const userFacingText = text
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .trim();
      const needsQueryResultReview =
        latestTest &&
        latestTest.askUser !== true &&
        (latestTest.ok === false ||
          (latestTest.ok === true && latestTest.rowCount === 0));
      if (needsQueryResultReview && state.queryResultReviewRetries < 1) {
        const resultIsEmpty =
          latestTest.ok === true && latestTest.rowCount === 0;
        const statesOutcome = resultIsEmpty
          ? /(?:zero|0|nenhuma|sem)\s+linhas|amostra\s+vazia/i.test(
              userFacingText,
            )
          : /(?:falh|erro|não foi valid|não foi conclu|não execut|não terminou)/i.test(
              userFacingText,
            );
        if (!statesOutcome && lastMessage.id) {
          clearPendingResponse(runtime.context);
          return {
            messages: [
              new RemoveMessage({ id: lastMessage.id }),
              new SystemMessage(
                resultIsEmpty
                  ? "QA da prévia: a última execução foi bem-sucedida, mas retornou zero linhas. Responda com uma frase completa dizendo isso explicitamente, deixe claro que a query ainda não foi salva e indique o próximo passo de análise ou revisão sem declarar sucesso dos dados."
                  : "QA da query: a última validação falhou ou não foi concluída. Responda com uma frase completa dizendo isso explicitamente, informe que a query não foi validada nem salva e indique o próximo passo concreto com base no erro recebido.",
              ),
            ],
            queryResultReviewRetries: state.queryResultReviewRetries + 1,
            jumpTo: "model" as const,
          };
        }
      }
      if (userFacingText || state.emptyResponseRetries >= 1) return;

      clearPendingResponse(runtime.context);
      return {
        messages: [
          new SystemMessage(
            "Revisão QA: a resposta final anterior não continha texto útil visível. Produza agora uma resposta curta em português que diga o resultado real e a próxima ação disponível. Não narre etapas internas e nunca diga que salvou sem a confirmação explícita da aplicação.",
          ),
        ],
        emptyResponseRetries: state.emptyResponseRetries + 1,
        jumpTo: "model" as const,
      };
    },
    canJumpTo: ["model"],
  },
});

export type AiChatRole = "user" | "assistant";

export interface AiAgentContext {
  currentUserId?: string;
  isAdmin?: boolean;
  pathname?: string;
  dashboardId?: string;
  threadId?: string;
  pendingDashboardContinuation?: boolean;
  clearPendingResponse?: () => void;
}

const aiAgentContextSchema = z.object({
  currentUserId: z.string().optional(),
  isAdmin: z.boolean().optional(),
  pathname: z.string().optional(),
  dashboardId: z.string().optional(),
  threadId: z.string().optional(),
  pendingDashboardContinuation: z.boolean().optional(),
  clearPendingResponse: z.function().optional(),
});

export type AiAgentToken = readonly [
  AIMessageChunk,
  { langgraph_node?: string; [key: string]: unknown },
];

export interface AiChatAgent {
  stream(
    input: { messages: Array<{ role: AiChatRole; content: string }> },
    config: RunnableConfig & {
      streamMode: "messages";
      context?: AiAgentContext;
    },
  ): Promise<AsyncIterable<AiAgentToken>>;
}

export function createAiAgentRunConfig(
  config: RunnableConfig,
  context: AiAgentContext,
): RunnableConfig & { context: AiAgentContext } {
  return { ...config, context, recursionLimit: AI_AGENT_RECURSION_LIMIT };
}

const DEFAULT_SYSTEM_PROMPT = [
  "Você é o assistente de IA da plataforma de dashboards do TCC.",
  "Responda em português brasileiro, com clareza e concisão.",
  "Seu escopo é somente a própria plataforma de dashboards: fontes de dados, tabelas, contextos, consultas SQL, dashboards, componentes e diagnóstico dessas funções.",
  "Recuse pedidos sem relação direta, como poemas, scripts Python genéricos ou algoritmos. Responda brevemente que pode ajudar apenas com a plataforma. Não use ferramentas ou formulários para pedidos fora do escopo.",
  "Nesta etapa você não tem ferramentas para consultar ou alterar dados, queries, contextos ou dashboards.",
  "Não afirme que executou consultas, salvou alterações ou atualizou a interface.",
].join(" ");

export interface AiAgentOptions {
  systemPrompt?: string;
  configuration?: ResolvedAiConfiguration;
  tools?: StructuredToolInterface[];
  context?: AiAgentContext;
}

class LangChainAiAgent implements AiChatAgent {
  private readonly model: ReturnType<AiConfigService["createModel"]>;

  constructor(
    private readonly options: AiAgentOptions,
    config: AiConfigService,
    private readonly checkpointer: AiCheckpointer,
  ) {
    this.model = config.createModel(options.configuration);
  }

  private async buildAgent() {
    const { threadId } = this.options.context ?? {};
    return createAgent({
      model: this.model,
      tools: this.options.tools ?? [],
      middleware: [threadMaintenance, finalResponseQa],
      checkpointer: threadId ? await this.checkpointer.get() : undefined,
      contextSchema: aiAgentContextSchema,
      systemPrompt: this.options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    });
  }

  async stream(
    input: Parameters<AiChatAgent["stream"]>[0],
    config: Parameters<AiChatAgent["stream"]>[1],
  ) {
    const { threadId, currentUserId } = this.options.context ?? {};
    const agent = await this.buildAgent();
    const runConfig = createAiAgentRunConfig(
      config,
      this.options.context ?? {},
    );
    const result = await agent.stream(input, {
      ...runConfig,
      // Scoped by user so a guessed thread id never exposes another admin's history.
      ...(threadId
        ? {
            configurable: {
              ...runConfig.configurable,
              thread_id: `${currentUserId ?? "anon"}:${threadId}`,
            },
          }
        : {}),
    });
    return result as AsyncIterable<AiAgentToken>;
  }
}

export class AiAgentFactory {
  constructor(
    private readonly config: AiConfigService,
    private readonly checkpointer: AiCheckpointer,
  ) {}

  create(options: AiAgentOptions = {}): AiChatAgent {
    return new LangChainAiAgent(options, this.config, this.checkpointer);
  }
}

export const aiAgentFactory = new AiAgentFactory(
  aiConfigService,
  aiCheckpointer,
);
