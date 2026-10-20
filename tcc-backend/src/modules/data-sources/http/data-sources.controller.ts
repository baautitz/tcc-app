import { z } from "zod";
import {
  sourceInputSchema,
  sourceUpdateInputSchema,
} from "../../../shared/lib/contracts.js";
import type { AppContext } from "../../../shared/middleware/auth.js";
import { jsonBody } from "../../../shared/middleware/json-body.js";
import { dataSourceAdminService as service } from "../application/data-source-admin.js";

export async function listSources(context: AppContext) {
  return context.json(await service.listSources());
}

export async function getSource(context: AppContext) {
  return context.json(
    await service.getSource(z.string().uuid().parse(context.req.param("id"))),
  );
}

export async function testSource(context: AppContext) {
  const input = await jsonBody(context, sourceInputSchema);
  return context.json(await service.testSource(input));
}

export async function createSource(context: AppContext) {
  const input = await jsonBody(context, sourceInputSchema);
  return context.json(
    await service.createSource(input, context.get("currentUser").id),
    201,
  );
}

export async function updateSource(context: AppContext) {
  const sourceId = z.string().uuid().parse(context.req.param("id"));
  const input = await jsonBody(context, sourceUpdateInputSchema);
  return context.json(await service.updateSource(sourceId, input));
}

export async function refreshSource(context: AppContext) {
  return context.json(
    await service.refreshSource(
      z.string().uuid().parse(context.req.param("id")),
    ),
  );
}

export async function updateTableContext(context: AppContext) {
  const sourceId = z.string().uuid().parse(context.req.param("sourceId"));
  const tableId = z.string().uuid().parse(context.req.param("tableId"));
  const input = await jsonBody(
    context,
    z
      .object({
        context: z.string().max(20000),
        expectedSourceUpdatedAt: z.string().datetime(),
        expectedContextVersion: z.number().int().positive(),
      })
      .strict(),
  );
  return context.json(
    await service.updateTableContext(sourceId, tableId, input),
  );
}

export async function deleteSource(context: AppContext) {
  await service.deleteSource(z.string().uuid().parse(context.req.param("id")));
  return context.body(null, 204);
}
