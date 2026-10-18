import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import type { z } from "zod";
import { ExternalQueryExecutionError, type UnsafeAiColumnType, runBoundedReadOnlyQueryWithRetry } from "../../modules/data-sources/infrastructure/external-pg/index.js";
import type { AiReadSource, AiReadTableName, AiToolProgressEvent } from "../ai-read-tools.js";
import {
  assertAiReadOnlySql,
  assertParameterDefinitions,
  assertSqlParameters,
  bindQueryParameters,
  QueryInputValidationError,
  assertAiCatalogTableReferences,
  type AiCatalogTableReference,
} from "../query-security.js";
import { queryDraftFingerprint } from "../query-lifecycle.js";
import type { QueryLifecycleQuery } from "../query-lifecycle.js";
import {
  inputSchema,
  MAX_DATABASE_ATTEMPTS,
  type CreateAiQueryTestToolsOptions,
} from "./query-test-schema.js";
import {
  buildQueryPreview,
  classifiedQueryFailure,
  recheckAfterQuery,
  sameSourceTarget,
  throwIfAborted,
  validationResult,
  withToolEvents,
  type RuntimeWithToolCallId,
} from "./query-test-helpers.js";

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

  let databaseAttempts = 0;

  const testQuery = tool(
    async (input: z.infer<typeof inputSchema>, runtime) =>
      withToolEvents(
        runtime as RuntimeWithToolCallId,
        onToolEvent,
        async (emit, toolCallId) => {
          throwIfAborted(runtime.signal);
          const fingerprint = queryDraftFingerprint(input);
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
              message: "A validação SQL não pode executar outra consulta ao banco nesta rodada.",
              askUser: false,
              retryable: false,
              instruction:
                "Não chame ask_admin_questions nem transforme o orçamento interno em uma escolha do administrador. Informe que a validação não terminou, relate somente resultados confirmados e não afirme que a query está pronta ou salva.",
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
            const recheck = await recheckAfterQuery(repository, input.dataSourceId, currentSource, sourceVersion, queryTarget);
            if ("failure" in recheck) return recheck.failure;
            const finalQueryTarget = recheck.finalQueryTarget;

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
            const { previewEvent, payload } = buildQueryPreview(input, source, finalQueryTarget, result, testRunId, toolCallId);
            await emit(previewEvent);
            return payload;
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
            return classifiedQueryFailure(classified);
          }
        },
      ),
    {
      name: "test_query",
      description:
        "Testa um rascunho SQL PostgreSQL em um servidor cadastrado usando apenas leitura, parâmetros vinculados e uma amostra com limites de tempo, linhas e bytes. Classifique purpose=dashboard somente quando a query for pré-requisito para um dashboard pedido pelo administrador; use quick_query para consultas pontuais sem etapa de dashboard. Aceita queries analíticas complexas, inclusive com CTEs e múltiplas relações, desde que use somente tabelas base do catálogo atualizado, colunas built-in e funções seguras; não aceita views, UDFs, extensões nem tipos customizados. Revise o esquema de cada tabela e os dados relevantes antes de testar; refine a consulta a partir de erros específicos sem repetir a mesma versão. Após sucesso emite uma prévia estruturada e recibo curto de uso único; nunca salva sem confirmação explícita do administrador. Para editar, use mode=update e um queryId existente; nunca invente IDs. Quando um parâmetro obrigatório faltar, pergunte ao administrador em vez de inventá-lo.",
      schema: inputSchema,
    },
  );

  return [testQuery];
}
