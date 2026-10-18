import { getSourceOrThrow } from "../../data-sources/application/data-source-admin.js";

import { z } from "zod";

import { savedQueriesRepository } from "../infrastructure/saved-queries-repository.js";
import { withDashboardFilesLock } from "../../../shared/db/db-executor.js";
import {
  
  
  parameterDefinitionSchema,
  queryInputSchema,
  
  
  queryTestInputSchema,
  
  
  
  
  
  type ParameterDefinition,
} from "../../../shared/lib/contracts.js";

import { externalSource } from "../../data-sources/application/external-source.js";

import type { DashboardFilesPort } from "../domain/dashboard-files-port.js";

import { assertParameterDefinitions, assertReadOnlySql, assertSqlParameters, bindQueryParameters } from "../../../shared/security/query-security.js";

import { ApiError } from "../../../shared/lib/domain-error.js";

export function parseParameters(value: unknown): ParameterDefinition[] {
  return z.array(parameterDefinitionSchema).parse(value);
}

export function validateQueryInput(input: Pick<z.infer<typeof queryInputSchema>, "dataSourceId" | "sqlText" | "parameters">): void {
  try {
    assertReadOnlySql(input.sqlText);
    assertParameterDefinitions(input.parameters);
    assertSqlParameters(input.sqlText, input.parameters);
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : "A query é inválida.");
  }
}
export async function getQueryOrThrow(queryId: string) {
  const query = await savedQueriesRepository.findById(queryId);
  if (!query) throw new ApiError(404, "Query não encontrada.");
  return query;
}
export const QUERY_LIFECYCLE_MESSAGES: Record<string, string> = {
  SOURCE_NOT_FOUND: "Servidor PostgreSQL não encontrado.",
  QUERY_NOT_FOUND: "Query não encontrada no servidor selecionado.",
  QUERY_VERSION_CONFLICT: "A query foi alterada desde a prévia. Recarregue-a e teste novamente.",
  RECEIPT_INVALID: "A prévia expirou, já foi usada ou não corresponde ao rascunho. Teste novamente antes de salvar.",
  RECEIPT_STALE: "A prévia expirou, já foi usada ou não corresponde ao rascunho. Teste novamente antes de salvar.",
};

export async function runQueryDefinition(input: z.infer<typeof queryTestInputSchema>): Promise<Record<string, unknown>[]> {
  const source = await getSourceOrThrow(input.dataSourceId);
  try {
    assertReadOnlySql(input.sqlText);
    assertParameterDefinitions(input.parameters);
    assertSqlParameters(input.sqlText, input.parameters);
    const bound = bindQueryParameters(input.sqlText, input.parameters, input.values);
    return await externalSource().runReadOnlyQuery(externalSource().sourceConnection(source), bound.sqlText, bound.values);
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : "Não foi possível testar a query.");
  }
}
let dashboardFiles: DashboardFilesPort | undefined;
export function configureDashboardFiles(port: DashboardFilesPort): void {
  dashboardFiles = port;
}

export async function deleteQueryWithDashboards(queryId: string): Promise<void> {
  if (!dashboardFiles) throw new Error("DashboardFilesPort não configurada.");
  const files = dashboardFiles;
  const dashboardRollbacks: Array<() => Promise<void>> = [];
  try {
    await files.withCompensation(
      () => withDashboardFilesLock(async (tx) => {
        const query = await savedQueriesRepository.lockNameById(tx, queryId);
        if (!query) throw new ApiError(404, "Query não encontrada.");

        const dashboardFileList = await files.getFiles();
        const lookupReference = dashboardFileList.flatMap(({ dashboard }) =>
          dashboard.workspace.params
            .filter((parameter) => parameter.lookup?.queryUuid === queryId)
            .map((parameter) => ({ dashboardName: dashboard.name, parameterLabel: parameter.label })),
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
          ) continue;

          const nextDashboard = {
            ...dashboard,
            queryBindings: nextBindings,
            ui: { ...dashboard.ui, components: nextComponents },
          };
          dashboardRollbacks.push(
            await files.writeAtomically(filePath, nextDashboard),
          );
        }

        const deleted = await savedQueriesRepository.deleteById(tx, queryId);
        if (deleted.length === 0) throw new ApiError(404, "Query não encontrada.");
      }),
      () => dashboardRollbacks.length > 0
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
              throw new AggregateError(rollbackErrors, "Não foi possível restaurar todos os dashboards.");
            }
          }
        : undefined,
    );
  } catch (error) {
    const failure = files.asCompensationFailure(error);
    if (failure) {
      console.error("[query] dashboard compensation failed after query deletion error", {
        operationError: failure.operationError,
        compensationError: failure.compensationError,
      });
      throw new ApiError(
        500,
        "A exclusão da query falhou e nem todas as alterações dos dashboards puderam ser restauradas. É necessária reconciliação administrativa.",
      );
    }
    if (error instanceof ApiError) throw error;
    throw error;
  }
}
