import { createAgent } from "langchain";
import { createMiddleware } from "langchain";
import { AIMessage, RemoveMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { AIMessageChunk } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { createAiModel, type ResolvedAiConfiguration } from "./agent-model-config.js";
import {
  clearPendingResponse,
  dashboardPreflightIssue,
  hasDashboardProposal,
  hasPendingDashboardQuestion,
  hasSuccessfulQueryUpdatePreview,
  hasUnresolvedTestQueryCall,
  latestQueryTestResult,
  latestUserAskedToAddDashboardComponent,
  latestUserRequestedQueryUpdate,
  missingEmptyPreviewAnalysis,
  queryPreflightIssue,
} from "./agent-preflight.js";

// Middleware hooks add graph steps around each model/tool cycle; leave room for
// staged schema analysis, bounded query retries, and the final QA pass.
export const AI_AGENT_RECURSION_LIMIT = 96;

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
      hasUnresolvedTestQueryCall(request.state.messages)
    ) {
      return new ToolMessage({
        content: JSON.stringify({
          ok: false,
          code: "QUERY_APPROVAL_REQUIRED",
          message: "A prévia da query precisa ser aprovada antes das próximas ações.",
          instruction: "Encerre esta rodada e aguarde a confirmação explícita do administrador no cartão da prévia. Só continue usando o UUID depois que a query for salva; nunca use testRunId como queryUuid.",
        }),
        tool_call_id: request.toolCall.id ?? crypto.randomUUID(),
        name: request.toolCall.name,
      });
    }
    if (request.toolCall.name === "create_or_update_dashboard") {
      const issue = dashboardPreflightIssue(request.state.messages, request.toolCall.args, request.runtime.context);
      if (issue) {
        clearPendingResponse(request.runtime.context);
        return new ToolMessage({
          content: JSON.stringify({
            ok: false,
            code: "DASHBOARD_CONTEXT_REQUIRED",
            message: issue,
            instruction: "Não aplique o patch ainda. Leia o dashboard alvo com get_current_dashboard, use os filtros e bindings retornados, preserve os componentes não mencionados e só então tente novamente.",
          }),
          tool_call_id: request.toolCall.id ?? crypto.randomUUID(),
          name: request.toolCall.name,
        });
      }
    }
    if (request.toolCall.name !== "test_query") return handler(request);
    const issue = queryPreflightIssue(
      request.state.messages,
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
      const latestTest = latestQueryTestResult(state.messages);
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
      const toolCalls = "tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls)
        ? lastMessage.tool_calls
        : [];

      const missingEmptyAnalysis = missingEmptyPreviewAnalysis(state.messages);
      if ((missingEmptyAnalysis.date || missingEmptyAnalysis.dimensions) && state.zeroRowsReviewRetries < 2) {
        const onlyAnalysisCalls = toolCalls.length > 0 && toolCalls.every((call) =>
          call.name === "analyze_date_coverage" || call.name === "analyze_column_values");
        if (onlyAnalysisCalls) return;
        if (!lastMessage.id) return;
        clearPendingResponse(runtime.context);
        const requiredAnalyses = [
          ...(missingEmptyAnalysis.date ? ["analyze_date_coverage na coluna temporal usada pela query"] : []),
          ...(missingEmptyAnalysis.dimensions ? ["analyze_column_values na dimensão ligada ao filtro multi_select"] : []),
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

      const queryUpdateRequest = latestUserRequestedQueryUpdate(state.messages);
      const latestTest = latestQueryTestResult(state.messages);
      if (
        queryUpdateRequest.requested &&
        !hasSuccessfulQueryUpdatePreview(state.messages, queryUpdateRequest.queryName) &&
        latestTest?.askUser !== true
      ) {
        if (state.queryUpdateRetries < 1 && lastMessage.id) {
          clearPendingResponse(runtime.context);
          return {
            messages: [
              new RemoveMessage({ id: lastMessage.id }),
              new SystemMessage(
                "O administrador pediu para editar uma query salva, mas você ainda não produziu um cartão query_preview com intent.mode='update'. Localize a query pelo nome em list_saved_queries, leia o SQL e os parâmetros com get_saved_query, preserve required=false e altere apenas o pedido. Depois use test_query com mode='update' e o mesmo queryId; conclua a rodada assim que a prévia for gerada. A aplicação exige confirmação humana para salvar. Se alguma ferramenta falhar ou não encontrar a query, não improvise nem declare sucesso: informe que o ajuste não foi concluído.",
              ),
            ],
            queryUpdateRetries: state.queryUpdateRetries + 1,
            jumpTo: "model" as const,
          };
        }
        if (lastMessage.id) {
          clearPendingResponse(runtime.context);
          return {
            messages: [
              new RemoveMessage({ id: lastMessage.id }),
              new AIMessage({
                content: "Não consegui gerar a prévia de atualização da query nesta tentativa. Nenhuma alteração foi salva; a query não foi ajustada. As ferramentas de leitura ou validação não concluíram o fluxo necessário.",
              }),
            ],
          };
        }
      }

      const dashboardRequest = latestUserAskedToAddDashboardComponent(state.messages, runtime.context);
      if (
        dashboardRequest &&
        !hasDashboardProposal(state.messages) &&
        !hasPendingDashboardQuestion(state.messages)
      ) {
        if (state.dashboardProposalRetries < 1 && lastMessage.id) {
          clearPendingResponse(runtime.context);
          return {
            messages: [
              new RemoveMessage({ id: lastMessage.id }),
              new SystemMessage(
                "O administrador pediu um componente de dashboard, mas você ainda não gerou uma prévia com create_or_update_dashboard. Leia o dashboard atual e as queries necessárias, respeite as decisões já respondidas, e chame a ferramenta para produzir o cartão actionCard de prévia. Se faltar query salva ou contexto indispensável, use o formulário apropriado. Não diga que a prévia está pronta sem o resultado da ferramenta; se ela falhar, informe que o dashboard não foi alterado e diga que o cartão não foi gerado.",
              ),
            ],
            dashboardProposalRetries: state.dashboardProposalRetries + 1,
            jumpTo: "model" as const,
          };
        }
        if (lastMessage.id) {
          clearPendingResponse(runtime.context);
          return {
            messages: [
              new RemoveMessage({ id: lastMessage.id }),
              new AIMessage({
                content: "Não consegui gerar o cartão de prévia do dashboard nesta rodada. Nenhuma alteração no dashboard foi aplicada.",
              }),
            ],
          };
        }
      }

      const content = lastMessage.content;
      const text = typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.flatMap((part) => (
            part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string"
              ? [part.text]
              : []
          )).join("")
          : "";
      const userFacingText = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      const needsQueryResultReview = latestTest
        && latestTest.askUser !== true
        && (latestTest.ok === false || (latestTest.ok === true && latestTest.rowCount === 0));
      if (needsQueryResultReview && state.queryResultReviewRetries < 1) {
        const resultIsEmpty = latestTest.ok === true && latestTest.rowCount === 0;
        const statesOutcome = resultIsEmpty
          ? /(?:zero|0|nenhuma|sem)\s+linhas|amostra\s+vazia/i.test(userFacingText)
          : /(?:falh|erro|não foi valid|não foi conclu|não execut|não terminou)/i.test(userFacingText);
        if (!statesOutcome && lastMessage.id) {
          clearPendingResponse(runtime.context);
          return {
            messages: [
              new RemoveMessage({ id: lastMessage.id }),
              new SystemMessage(resultIsEmpty
                ? "QA da prévia: a última execução foi bem-sucedida, mas retornou zero linhas. Responda com uma frase completa dizendo isso explicitamente, deixe claro que a query ainda não foi salva e indique o próximo passo de análise ou revisão sem declarar sucesso dos dados."
                : "QA da query: a última validação falhou ou não foi concluída. Responda com uma frase completa dizendo isso explicitamente, informe que a query não foi validada nem salva e indique o próximo passo concreto com base no erro recebido."),
            ],
            queryResultReviewRetries: state.queryResultReviewRetries + 1,
            jumpTo: "model" as const,
          };
        }
      }
      if (userFacingText || state.emptyResponseRetries >= 1) return;

      clearPendingResponse(runtime.context);
      return {
        messages: [new SystemMessage(
          "Revisão QA: a resposta final anterior não continha texto útil visível. Produza agora uma resposta curta em português que diga o resultado real e a próxima ação disponível. Não narre etapas internas e nunca diga que salvou sem a confirmação explícita da aplicação.",
        )],
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
  pendingDashboardContinuation?: boolean;
  clearPendingResponse?: () => void;
}

const aiAgentContextSchema = z.object({
  currentUserId: z.string().optional(),
  isAdmin: z.boolean().optional(),
  pathname: z.string().optional(),
  dashboardId: z.string().optional(),
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
    config: RunnableConfig & { streamMode: "messages"; context?: AiAgentContext },
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

export function createAiAgent(options: {
  systemPrompt?: string;
  configuration?: ResolvedAiConfiguration;
  tools?: StructuredToolInterface[];
  context?: AiAgentContext;
} = {}): AiChatAgent {
  const model = createAiModel(options.configuration);
  const agent = createAgent({
    model,
    tools: options.tools ?? [],
    middleware: [finalResponseQa],
    contextSchema: aiAgentContextSchema,
    systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
  });

  return {
    async stream(input, config) {
      const result = await agent.stream(input, {
        ...createAiAgentRunConfig(config, options.context ?? {}),
      });
      return result as AsyncIterable<AiAgentToken>;
    },
  };
}
