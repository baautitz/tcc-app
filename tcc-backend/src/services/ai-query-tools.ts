import {
  tool,
  type StructuredToolInterface,
  type ToolRuntime,
} from "@langchain/core/tools";
import { z } from "zod";
import { parameterDefinitionSchema } from "../lib/contracts.js";
import type { AuthenticatedUser } from "./auth.js";
import {
  ExternalQueryExecutionError,
  type UnsafeAiColumnType,
  runBoundedReadOnlyQueryWithRetry,
} from "./external-postgres.js";
import type { AiReadSource } from "./ai-read-tools.js";
import type { AiReadTableName } from "./ai-read-tools.js";
import type { AiToolProgressEvent } from "./ai-read-tools.js";
import {
  assertAiReadOnlySql,
  assertParameterDefinitions,
  assertSqlParameters,
  bindQueryParameters,
  QueryInputValidationError,
} from "./query-security.js";
import {
  assertAiCatalogTableReferences,
  type AiCatalogTableReference,
} from "./query-security.js";
import { queryDraftFingerprint } from "./query-lifecycle.js";
import type { QueryLifecycleQuery } from "./query-lifecycle.js";

const MAX_SQL_DRAFT_CHARACTERS = 20_000;
const MAX_SQL_DRAFTS = 3;
const MAX_DATABASE_ATTEMPTS = 6;

const inputSchema = z
  .object({
    dataSourceId: z
      .string()
      .uuid()
      .describe(
        "ID de um servidor PostgreSQL cadastrado, obtido pela ferramenta list_data_sources.",
      ),
    mode: z.enum(["create", "update"]).default("create").describe(
      "A intenção da revisão: create para salvar nova query ou update para editar uma query existente.",
    ),
    queryId: z.string().uuid().optional().describe(
      "ID da query existente que será editada; obrigatório quando mode=update. Nunca invente este ID.",
    ),
    queryName: z.string().trim().min(2).max(160).optional().describe(
      "Nome proposto para a query; em edição, omitido mantém o nome salvo atual.",
    ),
    sqlText: z
      .string()
      .trim()
      .min(8)
      .max(MAX_SQL_DRAFT_CHARACTERS)
      .describe(
        "Rascunho PostgreSQL somente leitura começando por SELECT ou WITH; parâmetros devem usar {{nome}}.",
      ),
    parameters: z
      .array(parameterDefinitionSchema)
      .max(50)
      .default([])
      .describe("Definições dos parâmetros {{nome}} usados pelo SQL."),
    values: z
      .record(
        z.string(),
        z.union([
          z.string().max(2_048),
          z.array(z.string().max(2_048)).max(50),
        ]),
      )
      .default({})
      .describe(
        "Valores informados pelo administrador. Não invente valores para parâmetros obrigatórios ausentes.",
      ),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.mode === "update" && !input.queryId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["queryId"],
        message: "Informe o ID da query que será editada.",
      });
    }
    if (input.mode === "create" && input.queryId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["queryId"],
        message: "Uma nova query não pode apontar para uma query existente.",
      });
    }
    if (Object.keys(input.values).length > 50)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["values"],
        message: "O máximo é 50 valores de parâmetros.",
      });
  });

export interface AiQueryTestRepository {
  findSource(dataSourceId: string): Promise<AiReadSource | undefined>;
  listCatalogTables(dataSourceId: string): Promise<AiReadTableName[]>;
  listLiveBaseTables(
    connection: AiReadSource["connection"],
  ): Promise<Array<{ schemaName: string; tableName: string }>>;
  findUnsafeColumnTypes(
    connection: AiReadSource["connection"],
    tables: AiCatalogTableReference[],
  ): Promise<UnsafeAiColumnType[]>;
  findSourceVersion(
    dataSourceId: string,
  ): Promise<{ updatedAt: Date; targetHash: string } | undefined>;
  findQueryTarget(queryId: string): Promise<Pick<QueryLifecycleQuery, "id" | "dataSourceId" | "name" | "updatedAt"> | undefined>;
  createTestReceipt(input: {
    actorId: string;
    dataSourceId: string;
    sourceUpdatedAt: Date;
    sourceTargetHash: string;
    draftFingerprint: string;
    mode: "create" | "update";
    queryId?: string;
    queryUpdatedAt?: Date;
  }): Promise<string>;
}

export interface AiQueryTestResult {
  rows: Record<string, unknown>[];
  rowLimit: number;
  byteLimit: number;
  bytes: number;
  truncated: boolean;
  truncationReason: "row_limit" | "byte_limit" | null;
}

export interface CreateAiQueryTestToolsOptions {
  currentUser: AuthenticatedUser;
  repository: AiQueryTestRepository;
  onToolEvent?: (event: AiToolProgressEvent) => void | Promise<void>;
  runQuery?: (
    source: AiReadSource,
    sqlText: string,
    values: unknown[],
    beforeAttempt: (attempt: number) => boolean,
    signal?: AbortSignal,
  ) => Promise<AiQueryTestResult>;
}

type RuntimeWithToolCallId = ToolRuntime & { toolCallId?: string };

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

async function withToolEvents<T>(
  runtime: RuntimeWithToolCallId,
  onToolEvent: CreateAiQueryTestToolsOptions["onToolEvent"],
  execute: (emit: (event: AiToolProgressEvent) => Promise<void>, toolCallId: string) => Promise<T>,
): Promise<T> {
  const toolCallId = runtime.toolCallId ?? crypto.randomUUID();
  const emit = async (event: AiToolProgressEvent) => {
    try {
      await onToolEvent?.(event);
    } catch {
      /* UI progress failures must not change query results. */
    }
  };
  await emit({ type: "tool_start", toolCallId, toolName: "test_query" });
  let ok = false;
  try {
    const result = await execute(emit, toolCallId);
    ok = !(
      result &&
      typeof result === "object" &&
      "ok" in result &&
      (result as { ok?: unknown }).ok === false
    );
    return result;
  } finally {
    if (!runtime.signal?.aborted)
      await emit({ type: "tool_result", toolCallId, toolName: "test_query", ok });
  }
}

function sameSourceTarget(left: AiReadSource, right: AiReadSource): boolean {
  return (
    left.id === right.id &&
    left.connection.host === right.connection.host &&
    left.connection.port === right.connection.port &&
    left.connection.database === right.connection.database &&
    left.connection.user === right.connection.user &&
    left.connection.password === right.connection.password
  );
}

function validationResult(
  error: QueryInputValidationError,
): Record<string, unknown> {
  if (error.code === "MISSING_PARAMETERS") {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      askUser: true,
      retryable: false,
      instruction:
        "Pergunte ao administrador pelos valores dos parâmetros obrigatórios. Não invente valores nem execute novas tentativas até receber a resposta.",
    };
  }
  return {
    ok: false,
    code: error.code,
    message: error.message,
    askUser: false,
    retryable: false,
    instruction:
      "Corrija o rascunho SQL e use test_query novamente, se ainda houver orçamento de rascunhos.",
  };
}

export function createAiQueryTestTools({
  currentUser,
  repository,
  onToolEvent,
  runQuery = async (source, sqlText, values, beforeAttempt, signal) =>
    runBoundedReadOnlyQueryWithRetry(source.connection, sqlText, values, {
      beforeAttempt,
      retrySignal: signal,
    }),
}: CreateAiQueryTestToolsOptions): StructuredToolInterface[] {
  if (!currentUser.isAdmin)
    throw new Error(
      "A ferramenta de teste de SQL está disponível apenas para administradores.",
    );

  const sqlDrafts = new Set<string>();
  let draftAttempts = 0;
  let databaseAttempts = 0;

  const testQuery = tool(
    async (input: z.infer<typeof inputSchema>, runtime) =>
      withToolEvents(
        runtime as RuntimeWithToolCallId,
        onToolEvent,
        async (emit, toolCallId) => {
          throwIfAborted(runtime.signal);
          const fingerprint = queryDraftFingerprint(input);
          if (
            draftAttempts >= MAX_SQL_DRAFTS ||
            (!sqlDrafts.has(fingerprint) && sqlDrafts.size >= MAX_SQL_DRAFTS)
          ) {
            return {
              ok: false,
              code: "SQL_DRAFT_LIMIT_REACHED",
              message: `Esta execução de chat já testou ${MAX_SQL_DRAFTS} rascunhos SQL diferentes.`,
              askUser: true,
              retryable: false,
              instruction:
                "Explique o bloqueio ao administrador e peça orientação adicional. Não gere nem teste mais SQL nesta execução de chat.",
            };
          }
          draftAttempts += 1;
          sqlDrafts.add(fingerprint);

          let bound: { sqlText: string; values: unknown[] };
          try {
            assertAiReadOnlySql(input.sqlText);
            assertParameterDefinitions(input.parameters);
            assertSqlParameters(input.sqlText, input.parameters);
            bound = bindQueryParameters(
              input.sqlText,
              input.parameters,
              input.values,
            );
          } catch (error) {
            if (error instanceof QueryInputValidationError)
              return validationResult(error);
            return {
              ok: false,
              code: "INVALID_SQL",
              message: "O rascunho SQL ou seus parâmetros são inválidos.",
              retryable: false,
            };
          }

          if (databaseAttempts >= MAX_DATABASE_ATTEMPTS) {
            return {
              ok: false,
              code: "DATABASE_ATTEMPT_LIMIT_REACHED",
              message: `Esta execução de chat atingiu o limite de ${MAX_DATABASE_ATTEMPTS} tentativas de execução do rascunho SQL ao banco de dados.`,
              askUser: true,
              retryable: false,
            };
          }

          let source: AiReadSource | undefined;
          try {
            source = await repository.findSource(input.dataSourceId);
          } catch {
            return {
              ok: false,
              code: "DATA_SOURCE_LOOKUP_FAILED",
              message:
                "Não foi possível localizar o servidor de dados cadastrado.",
              retryable: false,
            };
          }
          if (!source)
            return {
              ok: false,
              code: "DATA_SOURCE_NOT_FOUND",
              message: "Servidor PostgreSQL não encontrado.",
              retryable: false,
            };

          let sourceVersion: { updatedAt: Date; targetHash: string } | undefined;
          try {
            sourceVersion = await repository.findSourceVersion(source.id);
          } catch {
            return {
              ok: false,
              code: "DATA_SOURCE_LOOKUP_FAILED",
              message: "Não foi possível validar a versão do servidor.",
              retryable: false,
            };
          }
          if (!sourceVersion) {
            return {
              ok: false,
              code: "DATA_SOURCE_NOT_FOUND",
              message: "Servidor PostgreSQL não encontrado.",
              retryable: false,
            };
          }

          let queryTarget: Pick<QueryLifecycleQuery, "id" | "dataSourceId" | "name" | "updatedAt"> | undefined;
          if (input.mode === "update") {
            try {
              queryTarget = await repository.findQueryTarget(input.queryId!);
            } catch {
              return {
                ok: false,
                code: "QUERY_LOOKUP_FAILED",
                message: "Não foi possível localizar a query selecionada para edição.",
                retryable: false,
              };
            }
            if (!queryTarget || queryTarget.dataSourceId !== source.id) {
              return {
                ok: false,
                code: "QUERY_NOT_FOUND",
                message: "A query para edição não existe neste servidor.",
                retryable: false,
                askUser: true,
              };
            }
          }

          let catalogTables: AiReadTableName[];
          let liveTables: Array<{ schemaName: string; tableName: string }>;
          try {
            [catalogTables, liveTables] = await Promise.all([
              repository.listCatalogTables(source.id),
              repository.listLiveBaseTables(source.connection),
            ]);
          } catch {
            return {
              ok: false,
              code: "DATA_SOURCE_CATALOG_UNAVAILABLE",
              message:
                "Não foi possível validar o catálogo de tabelas deste servidor.",
              retryable: false,
            };
          }
          const tableKey = (table: { schemaName: string; tableName: string }) =>
            `${table.schemaName}\u0000${table.tableName}`;
          const catalogNames = new Set(catalogTables.map(tableKey));
          if (
            catalogNames.size !== liveTables.length ||
            liveTables.some((table) => !catalogNames.has(tableKey(table)))
          ) {
            return {
              ok: false,
              code: "DATA_SOURCE_CATALOG_STALE",
              message:
                "O catálogo de tabelas está desatualizado. Atualize as tabelas do servidor antes de testar SQL.",
              retryable: false,
              askUser: true,
            };
          }
          let referencedTables: AiCatalogTableReference[];
          try {
            referencedTables = assertAiCatalogTableReferences(
              input.sqlText,
              catalogTables,
            );
          } catch (error) {
            if (error instanceof QueryInputValidationError)
              return validationResult(error);
            return {
              ok: false,
              code: "INVALID_SQL",
              message:
                "A query referencia tabelas fora do catálogo autorizado.",
              retryable: false,
            };
          }

          let unsafeColumnTypes: UnsafeAiColumnType[];
          try {
            unsafeColumnTypes = await repository.findUnsafeColumnTypes(
              source.connection,
              referencedTables,
            );
          } catch {
            return {
              ok: false,
              code: "DATA_SOURCE_CATALOG_UNAVAILABLE",
              message:
                "Não foi possível validar os tipos das colunas das tabelas usadas. Tente novamente após confirmar o catálogo do servidor.",
              retryable: false,
            };
          }
          if (unsafeColumnTypes.length > 0) {
            return {
              ok: false,
              code: "UNSUPPORTED_TABLE_TYPES",
              message:
                "A prévia da IA não pode usar tabelas que contenham tipos PostgreSQL definidos pelo usuário, domains, enums ou composites. Remova essas relações da consulta ou peça ao administrador uma tabela compatível.",
              retryable: false,
              askUser: true,
            };
          }

          let currentSource: AiReadSource | undefined;
          try {
            currentSource = await repository.findSource(input.dataSourceId);
          } catch {
            return {
              ok: false,
              code: "DATA_SOURCE_CHANGED",
              message:
                "Não foi possível revalidar a configuração do servidor. Atualize a tela e tente novamente.",
              retryable: false,
            };
          }
          if (!currentSource || !sameSourceTarget(source, currentSource)) {
            return {
              ok: false,
              code: "DATA_SOURCE_CHANGED",
              message:
                "A configuração do servidor mudou durante a validação. Atualize os contextos e gere a prévia novamente.",
              retryable: false,
            };
          }

          let currentSourceVersion: { updatedAt: Date; targetHash: string } | undefined;
          try {
            currentSourceVersion = await repository.findSourceVersion(source.id);
          } catch {
            return {
              ok: false,
              code: "DATA_SOURCE_CHANGED",
              message: "Não foi possível confirmar a versão do servidor antes da consulta.",
              retryable: false,
            };
          }
          if (
            !currentSourceVersion ||
            currentSourceVersion.updatedAt.getTime() !== sourceVersion.updatedAt.getTime() ||
            currentSourceVersion.targetHash !== sourceVersion.targetHash
          ) {
            return {
              ok: false,
              code: "DATA_SOURCE_CHANGED",
              message: "O servidor foi alterado durante a validação. Gere uma nova prévia.",
              retryable: false,
              askUser: true,
            };
          }

          if (queryTarget) {
            let currentQuery: Awaited<ReturnType<typeof repository.findQueryTarget>>;
            try {
              currentQuery = await repository.findQueryTarget(queryTarget.id);
            } catch {
              return {
                ok: false,
                code: "QUERY_CHANGED",
                message: "Não foi possível confirmar a versão da query editada.",
                retryable: false,
              };
            }
            if (!currentQuery || currentQuery.updatedAt.getTime() !== queryTarget.updatedAt.getTime()) {
              return {
                ok: false,
                code: "QUERY_CHANGED",
                message: "A query mudou durante a validação. Leia a versão atual e gere uma nova prévia.",
                retryable: false,
                askUser: true,
              };
            }
          }

          throwIfAborted(runtime.signal);
          try {
            const result = await runQuery(
              currentSource,
              bound.sqlText,
              bound.values,
              () => {
                if (databaseAttempts >= MAX_DATABASE_ATTEMPTS) return false;
                databaseAttempts += 1;
                return true;
              },
              runtime.signal,
            );
            throwIfAborted(runtime.signal);
            let finalSource: AiReadSource | undefined;
            try {
              finalSource = await repository.findSource(input.dataSourceId);
            } catch {
              return {
                ok: false,
                code: "DATA_SOURCE_CHANGED",
                message:
                  "Não foi possível confirmar a configuração do servidor após a consulta. Descartei a amostra; atualize a tela e tente novamente.",
                retryable: false,
              };
            }
            if (!finalSource || !sameSourceTarget(currentSource, finalSource)) {
              return {
                ok: false,
                code: "DATA_SOURCE_CHANGED",
                message:
                  "A configuração do servidor mudou durante a consulta. Descartei a amostra; atualize os contextos e gere uma nova prévia.",
                retryable: false,
              };
            }
            const finalSourceVersion = await repository.findSourceVersion(source.id);
            if (
              !finalSourceVersion ||
              finalSourceVersion.updatedAt.getTime() !== sourceVersion.updatedAt.getTime() ||
              finalSourceVersion.targetHash !== sourceVersion.targetHash
            ) {
              return {
                ok: false,
                code: "DATA_SOURCE_CHANGED",
                message: "O servidor mudou durante a consulta. Descartei a amostra; gere uma nova prévia.",
                retryable: false,
              };
            }

            let finalQueryTarget: typeof queryTarget = queryTarget;
            if (queryTarget) {
              finalQueryTarget = await repository.findQueryTarget(queryTarget.id);
              if (!finalQueryTarget || finalQueryTarget.updatedAt.getTime() !== queryTarget.updatedAt.getTime()) {
                return {
                  ok: false,
                  code: "QUERY_CHANGED",
                  message: "A query mudou durante a consulta. Descartei a amostra; leia a versão atual e gere uma nova prévia.",
                  retryable: false,
                };
              }
            }

            let testRunId: string;
            try {
              testRunId = await repository.createTestReceipt({
                actorId: currentUser.id,
                dataSourceId: source.id,
                sourceUpdatedAt: sourceVersion.updatedAt,
                sourceTargetHash: sourceVersion.targetHash,
                draftFingerprint: fingerprint,
                mode: input.mode,
                queryId: queryTarget?.id,
                queryUpdatedAt: queryTarget?.updatedAt,
              });
            } catch {
              return {
                ok: false,
                code: "PREVIEW_STALE",
                message: "O servidor ou a query mudou no fim do teste. A amostra foi descartada; gere uma nova prévia.",
                retryable: false,
                askUser: true,
              };
            }
            const intent = {
              mode: input.mode,
              ...(finalQueryTarget ? {
                queryId: finalQueryTarget.id,
                queryName: input.queryName ?? finalQueryTarget.name,
                queryUpdatedAt: finalQueryTarget.updatedAt.toISOString(),
              } : {
                queryName: input.queryName ?? "Consulta gerada pela IA",
              }),
            };
            const previewEvent: AiToolProgressEvent = {
              type: "query_preview",
              toolCallId,
              testRunId,
              dataSource: { id: source.id, name: source.name },
              intent,
              sqlText: input.sqlText,
              parameters: input.parameters,
              testValues: input.values,
              rows: result.rows,
              rowCount: result.rows.length,
              rowLimit: result.rowLimit,
              byteLimit: result.byteLimit,
              bytes: result.bytes,
              truncated: result.truncated,
              truncationReason: result.truncationReason,
            };
            await emit(previewEvent);
            return {
              ok: true,
              testRunId,
              dataSource: { id: source.id, name: source.name },
              intent,
              sqlText: input.sqlText,
              parameters: input.parameters,
              testValues: input.values,
              rowCount: result.rows.length,
              rows: result.rows,
              rowLimit: result.rowLimit,
              byteLimit: result.byteLimit,
              bytes: result.bytes,
              truncated: result.truncated,
              truncationReason: result.truncationReason,
              instruction: result.truncated
                ? "A amostra foi limitada no servidor. Use a estrutura e as linhas retornadas para avaliar o rascunho; reduza colunas ou filtro se precisar de outra amostra."
                : "Esta é uma amostra limitada de leitura. Os valores numéricos são texto para preservar precisão. Apresente a prévia estruturada e aguarde a confirmação humana antes de salvar.",
            };
          } catch (error) {
            if (runtime.signal?.aborted)
              throw (
                runtime.signal.reason ?? new DOMException("Aborted", "AbortError")
              );
            if (error instanceof Error && error.name === "AbortError")
              throw error;
            const classified =
              error instanceof ExternalQueryExecutionError ? error : undefined;
            if (!classified) {
              return {
                ok: false,
                code: "QUERY_FAILED",
                message: "Não foi possível testar a consulta.",
                retryable: false,
                askUser: false,
              };
            }
            return {
              ok: false,
              code:
                classified.category === "timeout"
                  ? "QUERY_TIMEOUT"
                  : classified.category === "connection"
                    ? "DATA_SOURCE_UNAVAILABLE"
                    : "SQL_REJECTED",
              sqlState: classified.sqlState,
              message: classified.message,
              retryable: classified.retryable,
              askUser: false,
              instruction: classified.retryable
                ? "O servidor apresentou uma falha de transporte. Já foi aplicado no máximo um retry técnico; informe o administrador se persistir."
                : classified.category === "timeout"
                  ? "Não repita a mesma consulta automaticamente após timeout. Simplifique filtros/agregações ou peça orientação ao administrador."
                  : "Revise o esquema e os contextos consultados e corrija o SQL. Erros determinísticos e de permissão não devem ser repetidos sem alteração.",
            };
          }
        },
      ),
    {
      name: "test_query",
      description:
        "Testa um rascunho SQL PostgreSQL em um servidor cadastrado usando apenas leitura, parâmetros vinculados e uma amostra com limites de tempo, linhas e bytes. Só aceita tabelas base do catálogo atualizado, relações com colunas de tipos built-in e funções built-in aprovadas; não aceita views, UDFs, extensões nem colunas de tipos customizados. Após sucesso emite uma prévia estruturada e recibo curto de uso único; nunca salva sem confirmação explícita do administrador. Para editar, use mode=update e um queryId existente; nunca invente IDs. Máximo de 3 chamadas de teste SQL e 6 tentativas de execução do rascunho ao banco por execução de chat. Quando um parâmetro obrigatório faltar, pergunte ao administrador em vez de inventá-lo.",
      schema: inputSchema,
    },
  );

  return [testQuery];
}

export const AI_QUERY_TEST_LIMITS = {
  maxSqlDraftCharacters: MAX_SQL_DRAFT_CHARACTERS,
  maxDistinctSqlDrafts: MAX_SQL_DRAFTS,
  maxDatabaseAttempts: MAX_DATABASE_ATTEMPTS,
} as const;
