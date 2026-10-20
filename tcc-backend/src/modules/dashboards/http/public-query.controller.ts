import { z } from "zod";
import type { AppContext } from "../../../shared/middleware/auth.js";
import { ApiError } from "../../../shared/lib/domain-error.js";
import {
  getQueryOrThrow,
  parseParameters,
  runQueryDefinition,
} from "../../queries/application/query-admin.js";
import { canExecuteQuery } from "../domain/dashboard-access.js";
import { dashboardVisibilityService } from "../application/dashboard-visibility.js";

export async function runPublicQuery(context: AppContext) {
  const query = await getQueryOrThrow(
    z.string().uuid().parse(context.req.param("uuid")),
  );
  const currentUser = context.get("currentUser");
  const queryIds =
    await dashboardVisibilityService.accessibleQueryIds(currentUser);
  if (!canExecuteQuery(currentUser, query.id, queryIds)) {
    throw new ApiError(
      403,
      "A query não está vinculada a nenhum dashboard acessível por este usuário.",
    );
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
