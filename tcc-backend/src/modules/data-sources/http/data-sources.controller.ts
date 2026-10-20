import { z } from "zod";
import { getEnvironment } from "../../../shared/config/config.js";
import { dataSourcesRepository } from "../infrastructure/data-sources-repository.js";
import {
  sourceInputSchema,
  sourceUpdateInputSchema,
} from "../../../shared/lib/contracts.js";
import { encryptCredential } from "../../../shared/lib/credentials.js";

import { inspectReadOnlyPostgres } from "../infrastructure/external-pg/index.js";

import {
  hasDataSourceTargetChanged,
  MAX_DATA_SOURCE_CATALOG_TABLES,
  type CatalogSourceUpdate,
} from "../domain/data-source-catalog.js";
import { sourceContextRevisionChanged } from "../domain/data-source-context.js";

import { ApiError } from "../../../shared/lib/domain-error.js";
import { sourceConnection } from "../infrastructure/source-connection.js";

import type { AppContext } from "../../../shared/middleware/auth.js";
import { jsonBody } from "../../../shared/middleware/json-body.js";

import {
  catalogSourceSnapshot,
  safeSource,
  getSourceOrThrow,
  catalogSourceTables,
  updateCatalogTableContext,
} from "../application/data-source-admin.js";

const deps = { environment: getEnvironment(), now: () => Date.now() };

export async function listSources(context: AppContext) {
  const sources = await dataSourcesRepository.listAll();
  return context.json(sources.map(safeSource));
}

export async function getSource(context: AppContext) {
  const source = await getSourceOrThrow(
    z.string().uuid().parse(context.req.param("id")),
  );
  const tables = await dataSourcesRepository.listTables(
    source.id,
    MAX_DATA_SOURCE_CATALOG_TABLES + 1,
  );
  if (tables.length > MAX_DATA_SOURCE_CATALOG_TABLES) {
    throw new ApiError(
      409,
      `O catálogo excede o limite de ${MAX_DATA_SOURCE_CATALOG_TABLES} tabelas; contate um administrador.`,
    );
  }
  return context.json({ ...safeSource(source), tables });
}

export async function testSource(context: AppContext) {
  const input = await jsonBody(context, sourceInputSchema);
  const tables = await inspectReadOnlyPostgres({
    host: input.host,
    port: input.port,
    database: input.databaseName,
    user: input.username,
    password: input.password,
  });
  return context.json({ valid: true, tables });
}

export async function createSource(context: AppContext) {
  const input = await jsonBody(context, sourceInputSchema);
  const tables = await inspectReadOnlyPostgres({
    host: input.host,
    port: input.port,
    database: input.databaseName,
    user: input.username,
    password: input.password,
  });
  const source = await dataSourcesRepository.insert({
    name: input.name,
    host: input.host,
    port: input.port,
    databaseName: input.databaseName,
    username: input.username,
    encryptedPassword: encryptCredential(
      input.password,
      deps.environment.CREDENTIAL_ENCRYPTION_KEY,
    ),
    context: input.context,
    createdBy: context.get("currentUser").id,
  });
  if (!source)
    throw new ApiError(500, "Não foi possível salvar o servidor PostgreSQL.");
  await catalogSourceTables(source.id, tables);
  return context.json({ ...safeSource(source), tables }, 201);
}

export async function updateSource(context: AppContext) {
  const sourceId = z.string().uuid().parse(context.req.param("id"));
  const input = await jsonBody(context, sourceUpdateInputSchema);
  const existing = await getSourceOrThrow(sourceId);
  const expectedSourceSnapshot = catalogSourceSnapshot(existing);
  const password = input.password ?? sourceConnection(existing).password;
  const discovered = await inspectReadOnlyPostgres({
    host: input.host,
    port: input.port,
    database: input.databaseName,
    user: input.username,
    password,
  });
  const targetChanged = hasDataSourceTargetChanged(existing, input);
  const sourceUpdate: CatalogSourceUpdate = {
    name: input.name,
    host: input.host,
    port: input.port,
    databaseName: input.databaseName,
    username: input.username,
    encryptedPassword: encryptCredential(
      password,
      deps.environment.CREDENTIAL_ENCRYPTION_KEY,
    ),
    context: input.context,
    contextVersion:
      existing.contextVersion +
      (sourceContextRevisionChanged(
        existing,
        input,
        input.password !== undefined,
      )
        ? 1
        : 0),
    // Keep this token strictly increasing even when edits land within one ms.
    updatedAt: new Date(
      Math.max(deps.now(), expectedSourceSnapshot.updatedAt.getTime() + 1),
    ),
  };
  // A changed endpoint/database can have different semantics behind identical table names.
  // Clear table contexts together with the source update and catalog reconciliation.
  await catalogSourceTables(sourceId, discovered, {
    sourceUpdate,
    expectedSourceSnapshot,
    resetTableContexts: targetChanged,
  });
  const source = await getSourceOrThrow(sourceId);
  return context.json(safeSource(source));
}

export async function refreshSource(context: AppContext) {
  const source = await getSourceOrThrow(
    z.string().uuid().parse(context.req.param("id")),
  );
  const expectedSourceSnapshot = catalogSourceSnapshot(source);
  const tables = await inspectReadOnlyPostgres(sourceConnection(source));
  await catalogSourceTables(source.id, tables, { expectedSourceSnapshot });
  return context.json({ tables });
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
    await updateCatalogTableContext(sourceId, tableId, input),
  );
}

export async function deleteSource(context: AppContext) {
  const sourceId = z.string().uuid().parse(context.req.param("id"));
  await getSourceOrThrow(sourceId);
  const deleted = await dataSourcesRepository.deleteWithQueries(sourceId);
  if (deleted.length === 0)
    throw new ApiError(404, "Servidor PostgreSQL não encontrado.");
  return context.body(null, 204);
}
