

import { z } from "zod";
import { } from "../../../shared/config/config.js";
import { savedQueriesRepository } from "../infrastructure/saved-queries-repository.js";
import type { savedQueries } from "../../../shared/db/schema.js";
import {
  
  
  
  
  queryCreateInputSchema,
  queryPreviewInputSchema,
  
  queryUpdateInputSchema,
  
  
  
  
  
} from "../../../shared/lib/contracts.js";

import { runBoundedReadOnlyQueryWithRetry } from "../../data-sources/infrastructure/external-pg/index.js";
import { hasPermission } from "../../identity/application/auth.js";

import { canExecuteQuery } from "../../dashboards/domain/dashboard-access.js";
import { bindQueryParameters } from "../domain/security/query-security.js";

import { issueQueryTestReceipt, queryDraftFingerprint, querySourceTargetHash, saveQueryWithTestReceipt, type QueryLifecycleQuery } from "../domain/query-lifecycle.js";

import { ApiError } from "../../../shared/lib/domain-error.js";
import { sourceConnection } from "../../data-sources/infrastructure/source-connection.js";

import { createQueryLifecycleRepository } from "../infrastructure/query-lifecycle-repository.js";

import type { AppContext } from "../../../shared/middleware/auth.js";
import { jsonBody } from "../../../shared/middleware/json-body.js";
import { accessibleQueryIds } from "../../dashboards/application/dashboard-visibility.js";
import { getSourceOrThrow } from "../../data-sources/application/data-source-admin.js";
import { throwApiError } from "../../../shared/lib/domain-error.js";
import { parseParameters, validateQueryInput, getQueryOrThrow, QUERY_LIFECYCLE_MESSAGES, runQueryDefinition, deleteQueryWithDashboards } from "../application/query-admin.js";

export async function listQueries(context: AppContext) {
  return context.json(await savedQueriesRepository.listSummaries());
}

export async function getQuery(context: AppContext) {
  return context.json(await getQueryOrThrow(z.string().uuid().parse(context.req.param("id"))));
}

export async function previewQuery(context: AppContext) {
  const currentUser = context.get("currentUser");
  if (!hasPermission(currentUser, "queries:create") && !hasPermission(currentUser, "queries:update")) {
    throw new ApiError(403, "A permissão 'queries:create' ou 'queries:update' é necessária para testar uma query.");
  }
  const input = await jsonBody(context, queryPreviewInputSchema);
  const requiredPermission = input.mode === "create" ? "queries:create" : "queries:update";
  if (!hasPermission(currentUser, requiredPermission)) {
    throw new ApiError(403, `A permissão '${requiredPermission}' é necessária para pré-visualizar esta ação.`);
  }
  validateQueryInput(input);

  const source = await getSourceOrThrow(input.dataSourceId);
  const sourceUpdatedAt = source.updatedAt;
  const sourceTargetHash = querySourceTargetHash(source);
  let queryTarget: typeof savedQueries.$inferSelect | undefined;
  if (input.mode === "update") {
    queryTarget = await savedQueriesRepository.findById(input.queryId!);
    if (!queryTarget || queryTarget.dataSourceId !== source.id) {
      throw new ApiError(404, "A query para edição não existe neste servidor.");
    }
    if (!input.expectedUpdatedAt || queryTarget.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
      throw new ApiError(409, "A query foi alterada desde que foi aberta. Recarregue-a e teste novamente.");
    }
  }

  let preview;
  try {
    const bound = bindQueryParameters(input.sqlText, input.parameters, input.values);
    preview = await runBoundedReadOnlyQueryWithRetry(sourceConnection(source), bound.sqlText, bound.values, {
      preserveConfiguredSearchPath: true,
      allowGeneralReadOnlySql: true,
    });
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : "Não foi possível testar a query.");
  }

  const latestSource = await getSourceOrThrow(source.id);
  if (
    latestSource.updatedAt.getTime() !== sourceUpdatedAt.getTime() ||
    querySourceTargetHash(latestSource) !== sourceTargetHash
  ) {
    throw new ApiError(409, "O servidor foi alterado durante o teste. Gere uma nova prévia.");
  }
  if (queryTarget) {
    const latestQuery = await getQueryOrThrow(queryTarget.id);
    if (latestQuery.updatedAt.getTime() !== queryTarget.updatedAt.getTime()) {
      throw new ApiError(409, "A query foi alterada durante o teste. Recarregue-a e teste novamente.");
    }
  }

  let testRunId: string;
  try {
    testRunId = await issueQueryTestReceipt(createQueryLifecycleRepository(), {
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

  return context.json({
    ...preview,
    testRunId,
    dataSource: { id: source.id, name: source.name },
    intent: {
      mode: input.mode,
      queryName: queryTarget?.name ?? "Nova query",
      ...(queryTarget ? {
        queryId: queryTarget.id,
        queryUpdatedAt: queryTarget.updatedAt.toISOString(),
      } : {}),
    },
    sqlText: input.sqlText,
    parameters: input.parameters,
    testValues: input.values,
    rowCount: preview.rows.length,
  });
}

export async function createQuery(context: AppContext) {
  const input = await jsonBody(context, queryCreateInputSchema);
  validateQueryInput(input);
  const currentUser = context.get("currentUser");
  let query: QueryLifecycleQuery;
  try {
    query = await saveQueryWithTestReceipt(createQueryLifecycleRepository(), {
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
  return context.json(query, 201);
}

export async function updateQuery(context: AppContext) {
  const queryId = z.string().uuid().parse(context.req.param("id"));
  const input = await jsonBody(context, queryUpdateInputSchema);
  validateQueryInput(input);
  const currentUser = context.get("currentUser");
  let query: QueryLifecycleQuery;
  try {
    query = await saveQueryWithTestReceipt(createQueryLifecycleRepository(), {
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
  return context.json(query);
}

export async function testSavedQuery(context: AppContext) {
  const query = await getQueryOrThrow(z.string().uuid().parse(context.req.param("id")));
  const body = await jsonBody(context, z.object({ parameters: z.record(z.union([z.string(), z.array(z.string())])).default({}) }));
  return context.json({ rows: await runQueryDefinition({
    dataSourceId: query.dataSourceId,
    sqlText: query.sqlText,
    parameters: parseParameters(query.parameters),
    values: body.parameters,
  }) });
}

export async function deleteQuery(context: AppContext) {
  const queryId = z.string().uuid().parse(context.req.param("id"));
  await deleteQueryWithDashboards(queryId);
  return context.body(null, 204);
}

export async function runPublicQuery(context: AppContext) {
  const query = await getQueryOrThrow(z.string().uuid().parse(context.req.param("uuid")));
  const currentUser = context.get("currentUser");
  const queryIds = await accessibleQueryIds(currentUser);
  if (!canExecuteQuery(currentUser, query.id, queryIds)) {
    throw new ApiError(403, "A query não está vinculada a nenhum dashboard acessível por este usuário.");
  }
  const parameters = parseParameters(query.parameters);
  const rawParameters: Record<string, string | string[]> = {};
  const url = new URL(context.req.url);
  for (const name of new Set([...url.searchParams.keys()])) {
    const values = url.searchParams.getAll(name);
    rawParameters[name] = values.length > 1 ? values : values[0];
  }
  const rows = await runQueryDefinition({
    dataSourceId: query.dataSourceId,
    sqlText: query.sqlText,
    parameters,
    values: rawParameters,
  });
  return context.json({ rows });
}
