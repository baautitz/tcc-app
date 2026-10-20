import { z } from "zod";
import { withDashboardFilesLock } from "../../../shared/db/db-executor.js";
import type { savedQueries } from "../../../shared/db/schema.js";
import {
  parameterDefinitionSchema,
  type queryInputSchema,
  type queryPreviewInputSchema,
  type queryTestInputSchema,
  type ParameterDefinition,
} from "../../../shared/lib/contracts.js";
import { ApiError, throwApiError } from "../../../shared/lib/domain-error.js";
import {
  assertParameterDefinitions,
  assertReadOnlySql,
  assertSqlParameters,
  bindQueryParameters,
} from "../../../shared/security/query-security.js";
import type { DataSourceAdminService } from "../../data-sources/application/data-source-admin.js";
import type { ExternalSourcePort } from "../../data-sources/domain/external-source.js";
import {
  hasPermission,
  type AuthenticatedUser,
} from "../../identity/domain/auth-user.js";
import type { DashboardFilesPort } from "../domain/dashboard-files-port.js";
import {
  issueQueryTestReceipt,
  queryDraftFingerprint,
  querySourceTargetHash,
  saveQueryWithTestReceipt,
  type QueryLifecycleQuery,
  type QueryLifecycleRepository,
} from "../domain/query-lifecycle.js";
import { queryLifecycleRepository } from "../infrastructure/query-lifecycle-repository.js";
import {
  savedQueriesRepository,
  type SavedQueriesRepository,
} from "../infrastructure/saved-queries-repository.js";

export const QUERY_LIFECYCLE_MESSAGES: Record<string, string> = {
  SOURCE_NOT_FOUND: "Servidor PostgreSQL não encontrado.",
  QUERY_NOT_FOUND: "Query não encontrada no servidor selecionado.",
  QUERY_VERSION_CONFLICT:
    "A query foi alterada desde a prévia. Recarregue-a e teste novamente.",
  RECEIPT_INVALID:
    "A prévia expirou, já foi usada ou não corresponde ao rascunho. Teste novamente antes de salvar.",
  RECEIPT_STALE:
    "A prévia expirou, já foi usada ou não corresponde ao rascunho. Teste novamente antes de salvar.",
};

export interface QuerySaveInput {
  testRunId: string;
  dataSourceId: string;
  name: string;
  sqlText: string;
  parameters: ParameterDefinition[];
}

export interface SourceLookup {
  getSourceOrThrow: DataSourceAdminService["getSourceOrThrow"];
}

export class QueryService {
  constructor(
    private readonly repo: SavedQueriesRepository,
    private readonly lifecycle: QueryLifecycleRepository,
    private readonly externalSource: ExternalSourcePort,
    private readonly dashboardFiles: DashboardFilesPort,
    private readonly sources: SourceLookup,
  ) {}

  listQueries() {
    return this.repo.listSummaries();
  }

  parseParameters(value: unknown): ParameterDefinition[] {
    return z.array(parameterDefinitionSchema).parse(value);
  }

  validateQueryInput(
    input: Pick<
      z.infer<typeof queryInputSchema>,
      "dataSourceId" | "sqlText" | "parameters"
    >,
  ): void {
    try {
      assertReadOnlySql(input.sqlText);
      assertParameterDefinitions(input.parameters);
      assertSqlParameters(input.sqlText, input.parameters);
    } catch (error) {
      throw new ApiError(
        400,
        error instanceof Error ? error.message : "A query é inválida.",
      );
    }
  }

  async getQueryOrThrow(queryId: string) {
    const query = await this.repo.findById(queryId);
    if (!query) throw new ApiError(404, "Query não encontrada.");
    return query;
  }

  async runQueryDefinition(
    input: z.infer<typeof queryTestInputSchema>,
  ): Promise<Record<string, unknown>[]> {
    const source = await this.sources.getSourceOrThrow(input.dataSourceId);
    try {
      assertReadOnlySql(input.sqlText);
      assertParameterDefinitions(input.parameters);
      assertSqlParameters(input.sqlText, input.parameters);
      const bound = bindQueryParameters(
        input.sqlText,
        input.parameters,
        input.values,
      );
      return await this.externalSource.runReadOnlyQuery(
        this.externalSource.sourceConnection(source),
        bound.sqlText,
        bound.values,
      );
    } catch (error) {
      throw new ApiError(
        400,
        error instanceof Error
          ? error.message
          : "Não foi possível testar a query.",
      );
    }
  }

  async testSavedQuery(
    queryId: string,
    values: Record<string, string | string[]>,
  ) {
    const query = await this.getQueryOrThrow(queryId);
    return {
      rows: await this.runQueryDefinition({
        dataSourceId: query.dataSourceId,
        sqlText: query.sqlText,
        parameters: this.parseParameters(query.parameters),
        values,
      }),
    };
  }

  assertCanPreview(currentUser: AuthenticatedUser): void {
    if (
      !hasPermission(currentUser, "queries:create") &&
      !hasPermission(currentUser, "queries:update")
    ) {
      throw new ApiError(
        403,
        "A permissão 'queries:create' ou 'queries:update' é necessária para testar uma query.",
      );
    }
  }

  async previewQuery(
    currentUser: AuthenticatedUser,
    input: z.infer<typeof queryPreviewInputSchema>,
  ) {
    const requiredPermission =
      input.mode === "create" ? "queries:create" : "queries:update";
    if (!hasPermission(currentUser, requiredPermission)) {
      throw new ApiError(
        403,
        `A permissão '${requiredPermission}' é necessária para pré-visualizar esta ação.`,
      );
    }
    this.validateQueryInput(input);

    const source = await this.sources.getSourceOrThrow(input.dataSourceId);
    const sourceUpdatedAt = source.updatedAt;
    const sourceTargetHash = querySourceTargetHash(source);
    let queryTarget: typeof savedQueries.$inferSelect | undefined;
    if (input.mode === "update") {
      queryTarget = await this.repo.findById(input.queryId!);
      if (!queryTarget || queryTarget.dataSourceId !== source.id) {
        throw new ApiError(
          404,
          "A query para edição não existe neste servidor.",
        );
      }
      if (
        !input.expectedUpdatedAt ||
        queryTarget.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
      ) {
        throw new ApiError(
          409,
          "A query foi alterada desde que foi aberta. Recarregue-a e teste novamente.",
        );
      }
    }

    let preview;
    try {
      const bound = bindQueryParameters(
        input.sqlText,
        input.parameters,
        input.values,
      );
      preview = await this.externalSource.runBoundedReadOnlyQueryWithRetry(
        this.externalSource.sourceConnection(source),
        bound.sqlText,
        bound.values,
        {
          preserveConfiguredSearchPath: true,
          allowGeneralReadOnlySql: true,
        },
      );
    } catch (error) {
      throw new ApiError(
        400,
        error instanceof Error
          ? error.message
          : "Não foi possível testar a query.",
      );
    }

    const latestSource = await this.sources.getSourceOrThrow(source.id);
    if (
      latestSource.updatedAt.getTime() !== sourceUpdatedAt.getTime() ||
      querySourceTargetHash(latestSource) !== sourceTargetHash
    ) {
      throw new ApiError(
        409,
        "O servidor foi alterado durante o teste. Gere uma nova prévia.",
      );
    }
    if (queryTarget) {
      const latestQuery = await this.getQueryOrThrow(queryTarget.id);
      if (latestQuery.updatedAt.getTime() !== queryTarget.updatedAt.getTime()) {
        throw new ApiError(
          409,
          "A query foi alterada durante o teste. Recarregue-a e teste novamente.",
        );
      }
    }

    let testRunId: string;
    try {
      testRunId = await issueQueryTestReceipt(this.lifecycle, {
        actorId: currentUser.id,
        dataSourceId: source.id,
        sourceUpdatedAt,
        sourceTargetHash,
        draftFingerprint: queryDraftFingerprint(input),
        mode: input.mode,
        queryId: queryTarget?.id,
        queryUpdatedAt: queryTarget?.updatedAt,
      });
    } catch (error) {
      throwApiError(error, QUERY_LIFECYCLE_MESSAGES);
    }

    return {
      ...preview,
      testRunId,
      dataSource: { id: source.id, name: source.name },
      intent: {
        mode: input.mode,
        queryName: queryTarget?.name ?? "Nova query",
        ...(queryTarget
          ? {
              queryId: queryTarget.id,
              queryUpdatedAt: queryTarget.updatedAt.toISOString(),
            }
          : {}),
      },
      sqlText: input.sqlText,
      parameters: input.parameters,
      testValues: input.values,
      rowCount: preview.rows.length,
    };
  }

  async createQuery(
    currentUser: AuthenticatedUser,
    input: QuerySaveInput,
  ): Promise<QueryLifecycleQuery> {
    this.validateQueryInput(input);
    try {
      return await saveQueryWithTestReceipt(this.lifecycle, {
        receiptId: input.testRunId,
        actorId: currentUser.id,
        mode: "create",
        dataSourceId: input.dataSourceId,
        name: input.name,
        sqlText: input.sqlText,
        parameters: input.parameters,
        createdBy: currentUser.id,
      });
    } catch (error) {
      throwApiError(error, QUERY_LIFECYCLE_MESSAGES);
    }
  }

  async updateQuery(
    currentUser: AuthenticatedUser,
    queryId: string,
    input: QuerySaveInput & { expectedUpdatedAt: Date },
  ): Promise<QueryLifecycleQuery> {
    this.validateQueryInput(input);
    try {
      return await saveQueryWithTestReceipt(this.lifecycle, {
        receiptId: input.testRunId,
        actorId: currentUser.id,
        mode: "update",
        queryId,
        expectedUpdatedAt: input.expectedUpdatedAt,
        dataSourceId: input.dataSourceId,
        name: input.name,
        sqlText: input.sqlText,
        parameters: input.parameters,
        createdBy: currentUser.id,
      });
    } catch (error) {
      throwApiError(error, QUERY_LIFECYCLE_MESSAGES);
    }
  }

  async deleteQueryWithDashboards(queryId: string): Promise<void> {
    const files = this.dashboardFiles;
    const dashboardRollbacks: Array<() => Promise<void>> = [];
    try {
      await files.withCompensation(
        () =>
          withDashboardFilesLock(async (tx) => {
            const query = await this.repo.lockNameById(tx, queryId);
            if (!query) throw new ApiError(404, "Query não encontrada.");

            const dashboardFileList = await files.getFiles();
            const lookupReference = dashboardFileList.flatMap(({ dashboard }) =>
              dashboard.workspace.params
                .filter((parameter) => parameter.lookup?.queryUuid === queryId)
                .map((parameter) => ({
                  dashboardName: dashboard.name,
                  parameterLabel: parameter.label,
                })),
            )[0];
            if (lookupReference) {
              throw new ApiError(
                400,
                `A query '${query.name}' fornece as opções do filtro '${lookupReference.parameterLabel}' no dashboard '${lookupReference.dashboardName}'. Remova ou substitua esse lookup antes de excluir a query.`,
              );
            }

            for (const { dashboard, filePath } of dashboardFileList) {
              const nextComponents = dashboard.ui.components.filter(
                (component) => component.props.queryUuid !== queryId,
              );
              const nextBindings = dashboard.queryBindings.filter(
                (binding) => binding.queryUuid !== queryId,
              );
              if (
                nextComponents.length === dashboard.ui.components.length &&
                nextBindings.length === dashboard.queryBindings.length
              )
                continue;

              const nextDashboard = {
                ...dashboard,
                queryBindings: nextBindings,
                ui: { ...dashboard.ui, components: nextComponents },
              };
              dashboardRollbacks.push(
                await files.writeAtomically(filePath, nextDashboard),
              );
            }

            const deleted = await this.repo.deleteById(tx, queryId);
            if (deleted.length === 0)
              throw new ApiError(404, "Query não encontrada.");
          }),
        () =>
          dashboardRollbacks.length > 0
            ? async () => {
                const rollbackErrors: unknown[] = [];
                for (const rollback of dashboardRollbacks.reverse()) {
                  try {
                    await rollback();
                  } catch (error) {
                    rollbackErrors.push(error);
                  }
                }
                if (rollbackErrors.length > 0) {
                  throw new AggregateError(
                    rollbackErrors,
                    "Não foi possível restaurar todos os dashboards.",
                  );
                }
              }
            : undefined,
      );
    } catch (error) {
      const failure = files.asCompensationFailure(error);
      if (failure) {
        console.error(
          "[query] dashboard compensation failed after query deletion error",
          {
            operationError: failure.operationError,
            compensationError: failure.compensationError,
          },
        );
        throw new ApiError(
          500,
          "A exclusão da query falhou e nem todas as alterações dos dashboards puderam ser restauradas. É necessária reconciliação administrativa.",
        );
      }
      if (error instanceof ApiError) throw error;
      throw error;
    }
  }
}
