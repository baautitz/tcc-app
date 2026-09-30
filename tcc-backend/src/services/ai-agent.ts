import { createAgent } from "langchain";
import { createMiddleware } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { RemoveMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { AIMessageChunk } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { getEnvironment, type Environment } from "../config.js";
import { z } from "zod";
import { assertAiCatalogTableReferences } from "./query-security.js";

type AiEnvironment = Pick<Environment, "AI_BASE_URL" | "AI_API_KEY" | "AI_MODEL" | "AI_REQUEST_TIMEOUT_MS">;

export const DEFAULT_AI_REQUEST_TIMEOUT_MS = 180_000;
export const MIN_AI_REQUEST_TIMEOUT_MS = 1_000;
export const MAX_AI_REQUEST_TIMEOUT_MS = 300_000;
export const AI_MAX_OUTPUT_TOKENS = 12_288;
// Middleware hooks add graph steps around each model/tool cycle; leave room for
// staged schema analysis, bounded query retries, and the final QA pass.
export const AI_AGENT_RECURSION_LIMIT = 96;

function parseToolResult(content: unknown): Record<string, unknown> | undefined {
  if (content && typeof content === "object" && !Array.isArray(content)) {
    return content as Record<string, unknown>;
  }
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.flatMap((part) => (
        part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string"
          ? [part.text]
          : []
      )).join("")
      : "";
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function clearPendingResponse(runtimeContext: unknown): void {
  const clear = record(runtimeContext)?.clearPendingResponse;
  if (typeof clear === "function") clear();
}

export function queryPreflightIssue(messages: readonly unknown[], args: unknown): string | undefined {
  const input = record(args);
  const dataSourceId = typeof input?.dataSourceId === "string" ? input.dataSourceId : undefined;
  const sqlText = typeof input?.sqlText === "string" ? input.sqlText : undefined;
  if (!dataSourceId || !sqlText) return "A chamada de teste está incompleta. Corrija os argumentos antes de validar.";

  const successfulToolResults = messages.flatMap((message) => {
    const candidate = record(message);
    if (candidate?.type !== "tool" || candidate.status === "error") return [];
    const result = parseToolResult(candidate.content);
    return result ? [{ name: candidate.name, result }] : [];
  });
  const listedSource = successfulToolResults.some(({ name, result }) => name === "list_data_sources"
    && Array.isArray(result.sources)
    && result.sources.some((source) => record(source)?.id === dataSourceId));
  if (!listedSource) return "Antes do teste, liste as fontes disponíveis e confirme o ID da fonte escolhida.";

  const sourceCatalogResults = successfulToolResults
    .filter(({ name, result }) => name === "list_data_source_tables" && record(result.dataSource)?.id === dataSourceId);
  if (sourceCatalogResults.length === 0) return "Antes do teste, consulte o catálogo atualizado da fonte para encontrar as tabelas usadas pela query.";
  const catalogTables = sourceCatalogResults
    .flatMap(({ result }) => Array.isArray(result.tables) ? result.tables : [])
    .flatMap((table) => {
      const item = record(table);
      return typeof item?.schemaName === "string" && typeof item.tableName === "string"
        ? [{ schemaName: item.schemaName, tableName: item.tableName }]
        : [];
    });
  let referencedTables: Array<{ schemaName: string; tableName: string }>;
  try {
    referencedTables = assertAiCatalogTableReferences(sqlText, catalogTables);
  } catch {
    return "A query menciona tabelas que ainda não foram localizadas no catálogo. Consulte as tabelas corretas antes de testar.";
  }
  if (referencedTables.length === 0) return undefined;

  const inspectedTables = new Set(successfulToolResults
    .filter(({ name, result }) => name === "get_data_source_table_schema" && record(result.dataSource)?.id === dataSourceId)
    .flatMap(({ result }) => {
      const table = record(result.table);
      return typeof table?.schemaName === "string" && typeof table.tableName === "string"
        ? [`${table.schemaName}\u0000${table.tableName}`]
        : [];
    }));
  const unreadTables = referencedTables.filter((table) => !inspectedTables.has(`${table.schemaName}\u0000${table.tableName}`));
  if (unreadTables.length > 0) {
    return `Antes do teste, leia o esquema atualizado de todas as tabelas usadas pela query: ${unreadTables.map((table) => `${table.schemaName}.${table.tableName}`).join(", ")}.`;
  }

  const hasDateParameter = Array.isArray(input?.parameters)
    && input.parameters.some((parameter) => record(parameter)?.type === "date");
  if (hasDateParameter) {
    const coveredTableKeys = new Set(successfulToolResults
      .filter(({ name, result }) => name === "analyze_date_coverage"
        && record(result.dataSource)?.id === dataSourceId
        && record(result.coverage) !== undefined)
      .flatMap(({ result }) => {
        const table = record(result.table);
        return typeof table?.schemaName === "string" && typeof table.tableName === "string"
          ? [`${table.schemaName}\u0000${table.tableName}`]
          : [];
      }));
    if (!referencedTables.some((table) => coveredTableKeys.has(`${table.schemaName}\u0000${table.tableName}`))) {
      return "A query tem filtro de data. Analise a cobertura real de datas em uma tabela usada pela query antes de escolher os valores do teste.";
    }
  }
  const hasMultiSelectParameter = Array.isArray(input?.parameters)
    && input.parameters.some((parameter) => record(parameter)?.type === "multi_select");
  if (hasMultiSelectParameter) {
    const profiledTableKeys = new Set(successfulToolResults
      .filter(({ name, result }) => name === "analyze_column_values"
        && record(result.dataSource)?.id === dataSourceId
        && Array.isArray(result.values))
      .flatMap(({ result }) => {
        const table = record(result.table);
        return typeof table?.schemaName === "string" && typeof table.tableName === "string"
          ? [`${table.schemaName}\u0000${table.tableName}`]
          : [];
      }));
    if (!referencedTables.some((table) => profiledTableKeys.has(`${table.schemaName}\u0000${table.tableName}`))) {
      return "A query tem filtro multi_select. Analise os valores agregados de uma coluna de dimensão compatível com o filtro antes de escolher os valores do teste.";
    }
  }
  return undefined;
}

export function dashboardPreflightIssue(messages: readonly unknown[], args: unknown, runtimeContext: unknown): string | undefined {
  const input = record(args);
  if (input?.mode !== "update") return undefined;
  const dashboardId = typeof input.dashboardId === "string"
    ? input.dashboardId
    : record(runtimeContext)?.dashboardId;
  if (typeof dashboardId !== "string") {
    return "Informe qual dashboard existente será alterado.";
  }
  const dashboardWasRead = messages.some((message) => {
    const candidate = record(message);
    if (candidate?.type !== "tool" || candidate.name !== "get_current_dashboard" || candidate.status === "error") return false;
    const result = parseToolResult(candidate.content);
    return result?.dashboardId === dashboardId;
  });
  if (!dashboardWasRead) {
    return "Antes de propor a alteração, leia o dashboard atual para conferir filtros, bindings e componentes existentes.";
  }
  return undefined;
}

function missingEmptyPreviewAnalysis(messages: readonly unknown[]): { date: boolean; dimensions: boolean } {
  let latestTestIndex = -1;
  let latestTestWasEmpty = false;
  let latestTestNeedsDateReview = false;
  let latestTestNeedsDimensionReview = false;
  let latestTestDataSourceId: string | undefined;
  let latestTestTableKeys = new Set<string>();
  let latestCoverageIndex = -1;
  let latestProfileIndex = -1;
  messages.forEach((message, index) => {
    if (!message || typeof message !== "object") return;
    const candidate = message as { type?: unknown; name?: unknown; content?: unknown; status?: unknown };
    if (candidate.type !== "tool" || candidate.status === "error") return;
    if (candidate.name === "test_query") {
      const result = parseToolResult(candidate.content);
      latestTestIndex = index;
      latestTestWasEmpty = result?.ok === true && result.rowCount === 0;
      latestTestNeedsDateReview = latestTestWasEmpty
        && Array.isArray(result?.parameters)
        && result.parameters.some((parameter) => record(parameter)?.type === "date");
      latestTestNeedsDimensionReview = latestTestWasEmpty
        && Array.isArray(result?.parameters)
        && result.parameters.some((parameter) => record(parameter)?.type === "multi_select");
      latestTestDataSourceId = typeof record(result?.dataSource)?.id === "string"
        ? record(result?.dataSource)!.id as string
        : undefined;
      latestTestTableKeys = new Set();
      latestCoverageIndex = -1;
      latestProfileIndex = -1;
      if (latestTestDataSourceId && typeof result?.sqlText === "string") {
        const knownTables = messages.slice(0, index).flatMap((priorMessage) => {
          const prior = record(priorMessage);
          if (prior?.type !== "tool" || prior.name !== "list_data_source_tables" || prior.status === "error") return [];
          const listed = parseToolResult(prior.content);
          if (record(listed?.dataSource)?.id !== latestTestDataSourceId || !Array.isArray(listed?.tables)) return [];
          return listed.tables.flatMap((value) => {
            const table = record(value);
            return typeof table?.schemaName === "string" && typeof table.tableName === "string"
              ? [{ schemaName: table.schemaName, tableName: table.tableName }]
              : [];
          });
        });
        try {
          latestTestTableKeys = new Set(assertAiCatalogTableReferences(result.sqlText, knownTables)
            .map((table) => `${table.schemaName}\u0000${table.tableName}`));
        } catch {
          latestTestTableKeys = new Set();
        }
      }
    } else if (candidate.name === "analyze_date_coverage") {
      const result = parseToolResult(candidate.content);
      const sourceId = record(result?.dataSource)?.id;
      const table = record(result?.table);
      const tableKey = typeof table?.schemaName === "string" && typeof table.tableName === "string"
        ? `${table.schemaName}\u0000${table.tableName}`
        : undefined;
      const coversQueryTable = latestTestTableKeys.size === 0
        || (tableKey !== undefined && latestTestTableKeys.has(tableKey));
      if (sourceId === latestTestDataSourceId && record(result?.coverage) && coversQueryTable) latestCoverageIndex = index;
    } else if (candidate.name === "analyze_column_values") {
      const result = parseToolResult(candidate.content);
      const sourceId = record(result?.dataSource)?.id;
      const table = record(result?.table);
      const tableKey = typeof table?.schemaName === "string" && typeof table.tableName === "string"
        ? `${table.schemaName}\u0000${table.tableName}`
        : undefined;
      const coversQueryTable = latestTestTableKeys.size === 0
        || (tableKey !== undefined && latestTestTableKeys.has(tableKey));
      if (sourceId === latestTestDataSourceId && Array.isArray(result?.values) && coversQueryTable) latestProfileIndex = index;
    }
  });
  if (!latestTestWasEmpty || latestTestIndex < 0) return { date: false, dimensions: false };
  return {
    date: latestTestNeedsDateReview && latestTestIndex > latestCoverageIndex,
    dimensions: latestTestNeedsDimensionReview && latestTestIndex > latestProfileIndex,
  };
}

function latestQueryTestResult(messages: readonly unknown[]): Record<string, unknown> | undefined {
  let latest: Record<string, unknown> | undefined;
  for (const message of messages) {
    const candidate = record(message);
    if (candidate?.type !== "tool" || candidate.name !== "test_query" || candidate.status === "error") continue;
    latest = parseToolResult(candidate.content);
  }
  return latest;
}

function hasUnresolvedTestQueryCall(messages: readonly unknown[]): boolean {
  const testCallIds = new Set<string>();
  const resolvedCallIds = new Set<string>();
  for (const message of messages) {
    const candidate = record(message);
    if (!candidate) continue;
    if (candidate.type === "ai" && Array.isArray(candidate.tool_calls)) {
      for (const toolCall of candidate.tool_calls) {
        const call = record(toolCall);
        if (call?.name === "test_query" && typeof call.id === "string") {
          testCallIds.add(call.id);
        }
      }
    } else if (candidate.type === "tool" && typeof candidate.tool_call_id === "string") {
      resolvedCallIds.add(candidate.tool_call_id);
    }
  }
  return [...testCallIds].some((callId) => !resolvedCallIds.has(callId));
}

const finalResponseQa = createMiddleware({
  name: "final_response_qa",
  stateSchema: z.object({
    emptyResponseRetries: z.number().default(0),
    zeroRowsReviewRetries: z.number().default(0),
    queryResultReviewRetries: z.number().default(0),
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
            instruction: "Não gere a proposta ainda. Leia o dashboard alvo com get_current_dashboard, use os filtros e bindings retornados, preserve os componentes existentes e só então tente novamente.",
          }),
          tool_call_id: request.toolCall.id ?? crypto.randomUUID(),
          name: request.toolCall.name,
        });
      }
    }
    if (request.toolCall.name !== "test_query") return handler(request);
    const issue = queryPreflightIssue(request.state.messages, request.toolCall.args);
    if (!issue) return handler(request);
    clearPendingResponse(request.runtime.context);
    return new ToolMessage({
      content: JSON.stringify({
        ok: false,
        code: "QUERY_PREFLIGHT_REQUIRED",
        retryable: false,
        askUser: false,
        message: issue,
        instruction: "Não execute SQL ainda. Complete a etapa de análise indicada usando as ferramentas de leitura; depois reavalie a query e tente uma vez com SQL fundamentado no catálogo.",
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
      const latestTest = latestQueryTestResult(state.messages);
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

export type AiConfigurationIssue =
  | { enabled: false; code: "AI_NOT_CONFIGURED"; missing: string[] }
  | { enabled: false; code: "AI_CONFIGURATION_INVALID"; message: string };

export type ResolvedAiConfiguration =
  | { enabled: true; baseURL: string; apiKey: string; model: string; requestTimeoutMs: number }
  | AiConfigurationIssue;

export type AiChatRole = "user" | "assistant";

export interface AiAgentContext {
  currentUserId?: string;
  isAdmin?: boolean;
  pathname?: string;
  dashboardId?: string;
  clearPendingResponse?: () => void;
}

const aiAgentContextSchema = z.object({
  currentUserId: z.string().optional(),
  isAdmin: z.boolean().optional(),
  pathname: z.string().optional(),
  dashboardId: z.string().optional(),
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

export class AiUnavailableError extends Error {
  constructor(public readonly issue: AiConfigurationIssue) {
    super(issue.code === "AI_NOT_CONFIGURED"
      ? "O serviço de IA não está configurado."
      : "A configuração do serviço de IA é inválida.");
    this.name = "AiUnavailableError";
  }
}

function clean(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

export function resolveAiConfiguration(
  values: AiEnvironment = getEnvironment(),
): ResolvedAiConfiguration {
  const baseURL = clean(values.AI_BASE_URL);
  const apiKey = clean(values.AI_API_KEY);
  const model = clean(values.AI_MODEL);
  const configuredTimeout = clean(values.AI_REQUEST_TIMEOUT_MS);
  const missing = [
    ["AI_BASE_URL", baseURL],
    ["AI_API_KEY", apiKey],
    ["AI_MODEL", model],
  ].filter((entry): entry is [string, undefined] => entry[1] === undefined).map(([key]) => key);

  if (missing.length > 0) {
    return { enabled: false, code: "AI_NOT_CONFIGURED", missing };
  }

  try {
    const parsedBaseURL = new URL(baseURL!);
    if (parsedBaseURL.protocol !== "http:" && parsedBaseURL.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    return {
      enabled: false,
      code: "AI_CONFIGURATION_INVALID",
      message: "AI_BASE_URL deve ser uma URL HTTP ou HTTPS válida.",
    };
  }

  let requestTimeoutMs = DEFAULT_AI_REQUEST_TIMEOUT_MS;
  if (configuredTimeout !== undefined) {
    const parsedTimeout = Number(configuredTimeout);
    if (!Number.isSafeInteger(parsedTimeout)
      || parsedTimeout < MIN_AI_REQUEST_TIMEOUT_MS
      || parsedTimeout > MAX_AI_REQUEST_TIMEOUT_MS) {
      return {
        enabled: false,
        code: "AI_CONFIGURATION_INVALID",
        message: `AI_REQUEST_TIMEOUT_MS deve ser um inteiro entre ${MIN_AI_REQUEST_TIMEOUT_MS} e ${MAX_AI_REQUEST_TIMEOUT_MS}.`,
      };
    }
    requestTimeoutMs = parsedTimeout;
  }

  return { enabled: true, baseURL: baseURL!, apiKey: apiKey!, model: model!, requestTimeoutMs };
}

export function getAiAvailability(values: AiEnvironment = getEnvironment()):
  | { enabled: true; model: string }
  | AiConfigurationIssue {
  const configuration = resolveAiConfiguration(values);
  if (!configuration.enabled) return configuration;
  return { enabled: true, model: configuration.model };
}

export function createAiModel(configuration = resolveAiConfiguration()): ChatOpenAI {
  if (!configuration.enabled) throw new AiUnavailableError(configuration);

  const aiHost = new URL(configuration.baseURL).hostname.toLowerCase();
  const isMiniMax =
    aiHost === "minimax.io" ||
    aiHost.endsWith(".minimax.io") ||
    /minimax/i.test(configuration.model);
  const isMiniMaxM3 = isMiniMax && /minimax[-_. ]?m3/i.test(configuration.model);

  return new ChatOpenAI({
    model: configuration.model,
    apiKey: configuration.apiKey,
    maxTokens: AI_MAX_OUTPUT_TOKENS,
    ...(isMiniMax
      ? {
          // MiniMax's OpenAI-compatible API prefers max_completion_tokens.
          // Override ChatOpenAI's legacy max_tokens field while retaining the
          // public maxTokens setting for callers and diagnostics.
          modelKwargs: {
            max_tokens: undefined,
            max_completion_tokens: AI_MAX_OUTPUT_TOKENS,
            ...(isMiniMaxM3 ? { reasoning_split: false } : {}),
          },
        }
      : {}),
    configuration: { baseURL: configuration.baseURL },
    // Some OpenAI-compatible providers reject stream_options.
    streamUsage: false,
  });
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
