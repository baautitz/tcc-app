import { z } from "zod";
import {
  queryCreateInputSchema,
  queryPreviewInputSchema,
  queryUpdateInputSchema,
} from "../../../shared/lib/contracts.js";
import type { AppContext } from "../../../shared/middleware/auth.js";
import { jsonBody } from "../../../shared/middleware/json-body.js";
import { queryService } from "../application/query-admin.js";

const idParam = (context: AppContext) =>
  z.string().uuid().parse(context.req.param("id"));

export async function listQueries(context: AppContext) {
  return context.json(await queryService.listQueries());
}

export async function getQuery(context: AppContext) {
  return context.json(await queryService.getQueryOrThrow(idParam(context)));
}

export async function previewQuery(context: AppContext) {
  const currentUser = context.get("currentUser");
  queryService.assertCanPreview(currentUser);
  const input = await jsonBody(context, queryPreviewInputSchema);
  return context.json(await queryService.previewQuery(currentUser, input));
}

export async function createQuery(context: AppContext) {
  const input = await jsonBody(context, queryCreateInputSchema);
  return context.json(
    await queryService.createQuery(context.get("currentUser"), input),
    201,
  );
}

export async function updateQuery(context: AppContext) {
  const queryId = idParam(context);
  const input = await jsonBody(context, queryUpdateInputSchema);
  return context.json(
    await queryService.updateQuery(context.get("currentUser"), queryId, input),
  );
}

export async function testSavedQuery(context: AppContext) {
  const queryId = idParam(context);
  const body = await jsonBody(
    context,
    z.object({
      parameters: z
        .record(z.union([z.string(), z.array(z.string())]))
        .default({}),
    }),
  );
  return context.json(
    await queryService.testSavedQuery(queryId, body.parameters),
  );
}

export async function deleteQuery(context: AppContext) {
  await queryService.deleteQueryWithDashboards(idParam(context));
  return context.body(null, 204);
}
