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
import { assertAiCatalogTableReferences } from "./query-security.js";

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
  ) => Promise<AiQueryTestResult>;
}

type RuntimeWithToolCallId = ToolRuntime & { toolCallId?: string };

async function withToolEvents<T>(
  runtime: RuntimeWithToolCallId,
  onToolEvent: CreateAiQueryTestToolsOptions["onToolEvent"],
  execute: () => Promise<T>,
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
    const result = await execute();
    ok = !(
      result &&
      typeof result === "object" &&
      "ok" in result &&
      (result as { ok?: unknown }).ok === false
    );
    return result;
  } finally {
    await emit({ type: "tool_result", toolCallId, toolName: "test_query", ok });
  }
}

function draftFingerprint(sqlText: string): string {
  return sqlText.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
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
  runQuery = async (source, sqlText, values, beforeAttempt) =>
    runBoundedReadOnlyQueryWithRetry(source.connection, sqlText, values, {
      beforeAttempt,
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
        async () => {
          const fingerprint = draftFingerprint(input.sqlText);
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
              message: `Esta execução de chat atingiu o limite de ${MAX_DATABASE_ATTEMPTS} tentativas ao banco de dados.`,
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
          try {
            assertAiCatalogTableReferences(input.sqlText, catalogTables);
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
            );
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
            return {
              ok: true,
              rowCount: result.rows.length,
              rows: result.rows,
              rowLimit: result.rowLimit,
              byteLimit: result.byteLimit,
              bytes: result.bytes,
              truncated: result.truncated,
              truncationReason: result.truncationReason,
              instruction: result.truncated
                ? "A amostra foi limitada no servidor. Use a estrutura e as linhas retornadas para avaliar o rascunho; reduza colunas ou filtro se precisar de outra amostra."
                : "Esta é uma amostra limitada de leitura. Os valores numéricos são texto para preservar precisão. Não salve a query; apresente o SQL e os resultados para revisão do administrador.",
            };
          } catch (error) {
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
        "Testa um rascunho SQL PostgreSQL em um servidor cadastrado usando apenas leitura, parâmetros vinculados e uma amostra com limites de tempo, linhas e bytes. Só aceita tabelas base do catálogo atualizado e funções built-in aprovadas; não aceita views, UDFs nem extensões. Não salva query nem altera dados. Máximo de 3 chamadas de teste SQL e 6 tentativas de execução ao banco por execução de chat. Quando um parâmetro obrigatório faltar, pergunte o valor ao administrador em vez de inventá-lo.",
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
