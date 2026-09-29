import { Hono, type Context, type Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { and, asc, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { ZodError, z } from "zod";
import { getEnvironment } from "./config.js";
import { db } from "./db/client.js";
import { dashboardProposalReceipts, dashboardUsers, dashboards, dataSources, dataSourceTables, permissions, queryTestRuns, savedQueries, userPermissions, users } from "./db/schema.js";
import {
  passwordSchema,
  permissionKeySchema,
  parameterDefinitionSchema,
  queryInputSchema,
  queryCreateInputSchema,
  queryPreviewInputSchema,
  queryTestInputSchema,
  queryUpdateInputSchema,
  dashboardCreateSchema,
  dashboardDocumentSchema,
  sourceInputSchema,
  sourceUpdateInputSchema,
  type ParameterDefinition,
} from "./lib/contracts.js";
import { decryptCredential, encryptCredential } from "./lib/credentials.js";
import { hashPassword, verifyPassword } from "./lib/passwords.js";
import { findUnsafeAiColumnTypes, getPostgresTableColumns, inspectReadOnlyPostgres, listPostgresBaseTables, runBoundedReadOnlyQueryWithRetry, runReadOnlyQuery, type ExternalPostgresConfig } from "./services/external-postgres.js";
import { createSession, findAuthenticatedUser, hasPermission, revokeSession, SESSION_COOKIE, type AuthenticatedUser } from "./services/auth.js";
import { assignPermissionKeys } from "./services/permissions.js";
import { createDashboardFile, DashboardFileCompensationError, getDashboardFileById, getDashboardFiles, getRegisteredDashboardFiles, getRegisteredDashboards, isEditableDashboardFilePath, syncDashboardDirectory, withDashboardFileCompensation, writeDashboardDocumentAtomically } from "./services/dashboards.js";
import { buildDashboardDefinitionFromDocument, dashboardQueryReferences } from "./services/dashboard-sync.js";
import { canAccessDashboard, canExecuteQuery } from "./services/dashboard-access.js";
import { assertParameterDefinitions, assertReadOnlySql, assertSqlParameters, bindQueryParameters } from "./services/query-security.js";
import { createAiChatHandler } from "./services/ai-chat.js";
import { createAiReadTools, type AiReadSource, type AiReadTable, type AiReadTableName } from "./services/ai-read-tools.js";
import { createAiQueryTestTools } from "./services/ai-query-tools.js";
import { DataSourceCatalogSnapshotChangedError, hasDataSourceTargetChanged, MAX_DATA_SOURCE_CATALOG_TABLES, reconcileDataSourceCatalog, type CatalogSourceSnapshot, type CatalogSourceUpdate } from "./services/data-source-catalog.js";
import { DataSourceContextSourceNotFoundError, DataSourceContextVersionConflictError, updateTableContextIfSourceVersionMatches } from "./services/data-source-context.js";
import { issueQueryTestReceipt, QueryLifecycleError, queryDraftFingerprint, querySourceTargetHash, saveQueryWithTestReceipt, type QueryLifecycleQuery, type QueryLifecycleRepository, type QueryLifecycleTransaction, type QuerySaveMode, type QueryTestReceipt } from "./services/query-lifecycle.js";
import { createAiDashboardTools, type AiDashboardQuery, type AiDashboardQueryDefinition, type AiDashboardToolsRepository } from "./services/ai-dashboard-tools.js";
import { dashboardDocumentFingerprint, dashboardReferenceFingerprint } from "./services/ai-dashboard-proposals.js";
import { assertDashboardPreviewAcknowledged, assertDashboardProposalFresh, assertDashboardProposalUsable, isDashboardProposalAlreadyApplied } from "./services/dashboard-proposal-lifecycle.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type AppVariables = { currentUser: AuthenticatedUser };
type AppContext = Context<{ Variables: AppVariables }>;

class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const environment = getEnvironment();
const app = new Hono<{ Variables: AppVariables }>();

app.use("*", cors({
  origin: environment.FRONTEND_ORIGIN,
  credentials: true,
  allowHeaders: ["Content-Type"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
}));

app.onError((error, context) => {
  if (error instanceof ApiError) return context.json({ error: error.message }, error.status as never);
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const path = issue?.path.join(".");
    const message = issue
      ? `Dados inválidos${path ? ` em '${path}'` : ""}: ${issue.message}`
      : "Dados inválidos.";
    return context.json({ error: message, details: error.flatten() }, 400);
  }
  console.error(error);
  return context.json({ error: "Erro interno do servidor." }, 500);
});

app.get("/api/health", (context) => context.json({ status: "ok", timestamp: new Date().toISOString() }));

app.post("/api/admin/ai/chat", authentication, adminRequired, createAiChatHandler({
  createTools: ({ currentUser, pageContext, onToolEvent }) => {
    const repository = createAiReadToolsRepository();
    return [
      ...createAiReadTools({ currentUser, onToolEvent, repository }),
      ...createAiQueryTestTools({ currentUser, onToolEvent, repository }),
      ...createAiDashboardTools({
        currentUser,
        pageDashboardId: pageContext?.dashboardId,
        onToolEvent,
        repository: createAiDashboardToolsRepository(),
      }),
    ];
  },
}));

async function jsonBody<Schema extends z.ZodTypeAny>(context: Context, schema: Schema): Promise<z.output<Schema>> {
  try {
    return schema.parse(await context.req.json());
  } catch (error) {
    if (error instanceof ZodError) throw error;
    throw new ApiError(400, "O corpo da requisição deve ser JSON válido.");
  }
}

async function authentication(context: AppContext, next: Next): Promise<Response | void> {
  const currentUser = await findAuthenticatedUser(getCookie(context, SESSION_COOKIE));
  if (!currentUser) return context.json({ error: "Sessão inválida, expirada ou revogada." }, 401);
  context.set("currentUser", currentUser);
  await next();
}

function permissionRequired(permission: string) {
  return async (context: AppContext, next: Next): Promise<Response | void> => {
    const currentUser = context.get("currentUser");
    if (!hasPermission(currentUser, permission)) {
      return context.json({ error: `Acesso negado: a permissão '${permission}' é necessária.` }, 403);
    }
    await next();
  };
}

async function adminRequired(context: AppContext, next: Next): Promise<Response | void> {
  if (!context.get("currentUser").isAdmin) return context.json({ error: "Acesso restrito ao administrador." }, 403);
  await next();
}

function sourceConnection(source: typeof dataSources.$inferSelect): ExternalPostgresConfig {
  return {
    host: source.host,
    port: source.port,
    database: source.databaseName,
    user: source.username,
    password: decryptCredential(source.encryptedPassword, environment.CREDENTIAL_ENCRYPTION_KEY),
  };
}

async function syncDashboardDirectoryLocked() {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tcc-app:dashboard-files'))`);
    return syncDashboardDirectory(tx);
  });
}

function aiReadSource(source: typeof dataSources.$inferSelect): AiReadSource {
  return {
    id: source.id,
    name: source.name,
    databaseName: source.databaseName,
    context: source.context,
    connection: sourceConnection(source),
  };
}

function catalogSourceSnapshot(source: typeof dataSources.$inferSelect): CatalogSourceSnapshot {
  return {
    name: source.name,
    host: source.host,
    port: source.port,
    databaseName: source.databaseName,
    username: source.username,
    encryptedPassword: source.encryptedPassword,
    context: source.context,
    updatedAt: source.updatedAt,
  };
}

function aiReadTable(table: typeof dataSourceTables.$inferSelect): AiReadTable {
  return {
    id: table.id,
    dataSourceId: table.dataSourceId,
    schemaName: table.schemaName,
    tableName: table.tableName,
    context: table.context,
  };
}

function aiReadTableName(table: Pick<typeof dataSourceTables.$inferSelect, "id" | "dataSourceId" | "schemaName" | "tableName">): AiReadTableName {
  return {
    id: table.id,
    dataSourceId: table.dataSourceId,
    schemaName: table.schemaName,
    tableName: table.tableName,
  };
}

function createAiReadToolsRepository() {
  return {
    async listSources(offset: number, limit: number) {
      const [sources, countResult] = await Promise.all([
        db.select({ id: dataSources.id, name: dataSources.name })
          .from(dataSources)
          .orderBy(asc(dataSources.name))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(dataSources),
      ]);
      return { sources, total: Number(countResult[0]?.total ?? 0) };
    },
    async findSource(dataSourceId: string) {
      const source = (await db.select().from(dataSources).where(eq(dataSources.id, dataSourceId)).limit(1))[0];
      return source ? aiReadSource(source) : undefined;
    },
    async findSourceVersion(dataSourceId: string) {
      const source = (await db.select().from(dataSources).where(eq(dataSources.id, dataSourceId)).limit(1))[0];
      return source ? { updatedAt: source.updatedAt, targetHash: querySourceTargetHash(source) } : undefined;
    },
    async findQueryTarget(queryId: string) {
      const query = (await db.select({
        id: savedQueries.id,
        dataSourceId: savedQueries.dataSourceId,
        name: savedQueries.name,
        updatedAt: savedQueries.updatedAt,
      }).from(savedQueries).where(eq(savedQueries.id, queryId)).limit(1))[0];
      return query;
    },
    createTestReceipt(input: Parameters<typeof issueQueryTestReceipt>[1]) {
      return issueQueryTestReceipt(createQueryLifecycleRepository(), input);
    },
    async listCatalogTables(dataSourceId: string) {
      const tables = await db.select({
        id: dataSourceTables.id,
        dataSourceId: dataSourceTables.dataSourceId,
        schemaName: dataSourceTables.schemaName,
        tableName: dataSourceTables.tableName,
      }).from(dataSourceTables)
        .where(eq(dataSourceTables.dataSourceId, dataSourceId))
        .orderBy(asc(dataSourceTables.schemaName), asc(dataSourceTables.tableName))
        .limit(MAX_DATA_SOURCE_CATALOG_TABLES + 1);
      if (tables.length > MAX_DATA_SOURCE_CATALOG_TABLES) {
        throw new Error(`O catálogo salvo excede o limite de ${MAX_DATA_SOURCE_CATALOG_TABLES} tabelas.`);
      }
      return tables.map(aiReadTableName);
    },
    async findCatalogTable(dataSourceId: string, tableId: string) {
      const table = (await db.select().from(dataSourceTables)
        .where(and(eq(dataSourceTables.dataSourceId, dataSourceId), eq(dataSourceTables.id, tableId)))
        .limit(1))[0];
      return table ? aiReadTable(table) : undefined;
    },
    listLiveBaseTables: listPostgresBaseTables,
    findUnsafeColumnTypes: findUnsafeAiColumnTypes,
    getLiveColumns: getPostgresTableColumns,
  };
}

function safeSource(source: typeof dataSources.$inferSelect) {
  const { encryptedPassword: _encryptedPassword, ...safe } = source;
  return safe;
}

function parseParameters(value: unknown): ParameterDefinition[] {
  return z.array(parameterDefinitionSchema).parse(value);
}

function validateQueryInput(input: Pick<z.infer<typeof queryInputSchema>, "dataSourceId" | "sqlText" | "parameters">): void {
  try {
    assertReadOnlySql(input.sqlText);
    assertParameterDefinitions(input.parameters);
    assertSqlParameters(input.sqlText, input.parameters);
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : "A query é inválida.");
  }
}

async function assertKnownPermissionKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const known = await db.select({ key: permissions.key }).from(permissions).where(inArray(permissions.key, keys));
  if (known.length !== keys.length) throw new ApiError(400, "Uma ou mais permissões não existem no catálogo.");
}

async function getSourceOrThrow(sourceId: string) {
  const source = (await db.select().from(dataSources).where(eq(dataSources.id, sourceId)).limit(1))[0];
  if (!source) throw new ApiError(404, "Servidor PostgreSQL não encontrado.");
  return source;
}

async function getQueryOrThrow(queryId: string) {
  const query = (await db.select().from(savedQueries).where(eq(savedQueries.id, queryId)).limit(1))[0];
  if (!query) throw new ApiError(404, "Query não encontrada.");
  return query;
}

function createQueryLifecycleRepository(): QueryLifecycleRepository {
  return {
    transaction<T>(operation: (tx: QueryLifecycleTransaction) => Promise<T>) {
      return db.transaction(async (tx) => operation({
        async lockSource(dataSourceId) {
          return (await tx.select().from(dataSources)
            .where(eq(dataSources.id, dataSourceId))
            .for("update")
            .limit(1))[0];
        },
        async lockQuery(queryId) {
          return (await tx.select().from(savedQueries)
            .where(eq(savedQueries.id, queryId))
            .for("update")
            .limit(1))[0];
        },
        async insertReceipt(receipt) {
          await tx.execute(sql`DELETE FROM query_test_runs
            WHERE id IN (
              SELECT id FROM query_test_runs
              WHERE expires_at <= now()
                OR (consumed_at IS NOT NULL AND consumed_at < now() - interval '1 day')
              ORDER BY expires_at ASC
              LIMIT 500
            )`);
          const inserted = (await tx.insert(queryTestRuns).values(receipt).returning())[0];
          if (!inserted) throw new ApiError(500, "Não foi possível registrar a prévia.");
          return { ...inserted, mode: inserted.mode as QuerySaveMode };
        },
        async consumeReceipt(receiptId, actorId, now) {
          const consumed = (await tx.update(queryTestRuns)
            .set({ consumedAt: now })
            .where(and(
              eq(queryTestRuns.id, receiptId),
              eq(queryTestRuns.actorId, actorId),
              isNull(queryTestRuns.consumedAt),
              gt(queryTestRuns.expiresAt, now),
            ))
            .returning())[0];
          return consumed ? { ...consumed, mode: consumed.mode as QuerySaveMode } : undefined;
        },
        async insertQuery(query) {
          const inserted = (await tx.insert(savedQueries).values(query).returning())[0];
          if (!inserted) throw new ApiError(500, "Não foi possível criar a query.");
          return inserted;
        },
        async updateQuery(queryId, update) {
          return (await tx.update(savedQueries)
            .set(update)
            .where(eq(savedQueries.id, queryId))
            .returning())[0];
        },
      }));
    },
  };
}

function createAiDashboardToolsRepository(): AiDashboardToolsRepository {
  return {
    async listSavedQueries(): Promise<AiDashboardQuery[]> {
      const rows = await db.select({
        id: savedQueries.id,
        name: savedQueries.name,
        dataSourceId: savedQueries.dataSourceId,
        parameters: savedQueries.parameters,
        updatedAt: savedQueries.updatedAt,
        sourceUpdatedAt: dataSources.updatedAt,
        sourceHost: dataSources.host,
        sourcePort: dataSources.port,
        sourceDatabase: dataSources.databaseName,
        sourceUsername: dataSources.username,
        sourcePassword: dataSources.encryptedPassword,
      }).from(savedQueries).innerJoin(dataSources, eq(savedQueries.dataSourceId, dataSources.id))
        .orderBy(asc(savedQueries.name)).limit(201);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        dataSourceId: row.dataSourceId,
        parameters: row.parameters,
        updatedAt: row.updatedAt,
        sourceUpdatedAt: row.sourceUpdatedAt,
        sourceTargetHash: querySourceTargetHash({
          id: row.dataSourceId,
          updatedAt: row.sourceUpdatedAt,
          host: row.sourceHost,
          port: row.sourcePort,
          databaseName: row.sourceDatabase,
          username: row.sourceUsername,
          encryptedPassword: row.sourcePassword,
        }),
      }));
    },
    async findSavedQueries(ids: string[]): Promise<AiDashboardQueryDefinition[]> {
      if (ids.length === 0) return [];
      const rows = await db.select({
        id: savedQueries.id,
        name: savedQueries.name,
        dataSourceId: savedQueries.dataSourceId,
        sqlText: savedQueries.sqlText,
        parameters: savedQueries.parameters,
        updatedAt: savedQueries.updatedAt,
        source: dataSources,
      }).from(savedQueries).innerJoin(dataSources, eq(savedQueries.dataSourceId, dataSources.id))
        .where(inArray(savedQueries.id, ids));
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        dataSourceId: row.dataSourceId,
        sqlText: row.sqlText,
        parameters: row.parameters,
        updatedAt: row.updatedAt,
        sourceUpdatedAt: row.source.updatedAt,
        sourceTargetHash: querySourceTargetHash(row.source),
        connection: sourceConnection(row.source),
      }));
    },
    async findDashboard(id: string) {
      const match = (await getRegisteredDashboardFiles()).find((item) => item.dashboard.id === id.toLowerCase());
      return match ? {
        document: match.dashboard,
        fingerprint: dashboardDocumentFingerprint(match.dashboard),
      } : undefined;
    },
    async runPreview(query, values) {
      const parameters = z.array(parameterDefinitionSchema).parse(query.parameters);
      assertParameterDefinitions(parameters);
      assertSqlParameters(query.sqlText, parameters);
      const bound = bindQueryParameters(query.sqlText, parameters, values);
      const result = await runBoundedReadOnlyQueryWithRetry(
        query.connection as ExternalPostgresConfig,
        bound.sqlText,
        bound.values,
        {
          rowLimit: 50,
          byteLimit: 48_000,
          preserveConfiguredSearchPath: true,
          allowGeneralReadOnlySql: true,
        },
      );
      return result;
    },
    async issueReceipt(input) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`DELETE FROM dashboard_proposal_receipts
          WHERE id IN (
            SELECT id FROM dashboard_proposal_receipts
            WHERE expires_at <= now()
              OR (consumed_at IS NOT NULL AND consumed_at < now() - interval '1 day')
            ORDER BY expires_at ASC
            LIMIT 200
          )`);
        await tx.insert(dashboardProposalReceipts).values(input);
      });
    },
  };
}

function queryLifecycleApiError(error: unknown): never {
  if (!(error instanceof QueryLifecycleError)) throw error;
  switch (error.code) {
    case "SOURCE_NOT_FOUND":
      throw new ApiError(404, "Servidor PostgreSQL não encontrado.");
    case "QUERY_NOT_FOUND":
      throw new ApiError(404, "Query não encontrada no servidor selecionado.");
    case "QUERY_VERSION_CONFLICT":
      throw new ApiError(409, "A query foi alterada desde a prévia. Recarregue-a e teste novamente.");
    case "RECEIPT_INVALID":
    case "RECEIPT_STALE":
      throw new ApiError(409, "A prévia expirou, já foi usada ou não corresponde ao rascunho. Teste novamente antes de salvar.");
  }
}

async function getAccessibleDashboards(currentUser: AuthenticatedUser) {
  const registered = await getRegisteredDashboards();
  if (currentUser.isAdmin) return registered;
  const assignments = await db.select({ dashboardId: dashboardUsers.dashboardId })
    .from(dashboardUsers)
    .where(eq(dashboardUsers.userId, currentUser.id));
  const assignedIds = new Set(assignments.map((assignment) => assignment.dashboardId));
  return registered.filter((dashboard) => canAccessDashboard(currentUser, dashboard.id, assignedIds));
}

async function assertDashboardAccess(currentUser: AuthenticatedUser, dashboardId: string): Promise<void> {
  if (currentUser.isAdmin) return;
  const assignment = (await db.select({ dashboardId: dashboardUsers.dashboardId })
    .from(dashboardUsers)
    .where(and(eq(dashboardUsers.dashboardId, dashboardId), eq(dashboardUsers.userId, currentUser.id)))
    .limit(1))[0];
  if (!canAccessDashboard(currentUser, dashboardId, new Set(assignment ? [assignment.dashboardId] : []))) {
    throw new ApiError(403, "O usuário não possui acesso a este dashboard.");
  }
}

async function accessibleQueryIds(currentUser: AuthenticatedUser): Promise<Set<string>> {
  if (currentUser.isAdmin) {
    const rows = await db.select({ id: savedQueries.id }).from(savedQueries);
    return new Set(rows.map((row) => row.id));
  }
  const dashboardsForUser = await getAccessibleDashboards(currentUser);
  return new Set(dashboardsForUser.flatMap((dashboard) => [...dashboardQueryReferences(dashboard)]));
}

async function runQueryDefinition(input: z.infer<typeof queryTestInputSchema>): Promise<Record<string, unknown>[]> {
  const source = await getSourceOrThrow(input.dataSourceId);
  try {
    assertReadOnlySql(input.sqlText);
    assertParameterDefinitions(input.parameters);
    assertSqlParameters(input.sqlText, input.parameters);
    const bound = bindQueryParameters(input.sqlText, input.parameters, input.values);
    return await runReadOnlyQuery(sourceConnection(source), bound.sqlText, bound.values);
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : "Não foi possível testar a query.");
  }
}

app.post("/api/auth/login", async (context) => {
  const body = await jsonBody(context, z.object({ email: z.string().email(), password: z.string().min(1) }));
  const user = (await db.select().from(users).where(eq(users.email, body.email.toLowerCase())).limit(1))[0];
  if (!user || !user.active || !verifyPassword(body.password, user.passwordHash)) {
    throw new ApiError(401, "E-mail ou senha inválidos.");
  }
  const session = await createSession(user.id);
  setCookie(context, SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: environment.NODE_ENV === "production",
    path: "/",
    expires: session.expiresAt,
  });
  const authenticated = await findAuthenticatedUser(session.token);
  return context.json({ user: authenticated });
});

app.post("/api/auth/logout", async (context) => {
  await revokeSession(getCookie(context, SESSION_COOKIE));
  deleteCookie(context, SESSION_COOKIE, { path: "/" });
  return context.body(null, 204);
});

app.get("/api/auth/me", authentication, (context: AppContext) => context.json({ user: context.get("currentUser") }));

app.get("/api/users", authentication, permissionRequired("users:read"), async (context) => {
  const rows = await db.select({ user: users }).from(users).orderBy(asc(users.name));
  const assignments = await db.select({ userId: userPermissions.userId, key: permissions.key })
    .from(userPermissions)
    .innerJoin(permissions, eq(userPermissions.permissionId, permissions.id));
  return context.json(rows.map(({ user }) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    isAdmin: user.isAdmin,
    active: user.active,
    createdAt: user.createdAt,
    permissions: assignments.filter((assignment) => assignment.userId === user.id).map((assignment) => assignment.key),
  })));
});

const userCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(320),
  password: passwordSchema,
  permissionKeys: z.array(permissionKeySchema).default([]),
});

const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  email: z.string().trim().email().max(320).optional(),
  password: passwordSchema.optional(),
  active: z.boolean().optional(),
  permissionKeys: z.array(permissionKeySchema).optional(),
});

app.post("/api/users", authentication, permissionRequired("users:create"), async (context) => {
  const input = await jsonBody(context, userCreateSchema);
  await assertKnownPermissionKeys(input.permissionKeys);
  const user = (await db.insert(users).values({
    name: input.name,
    email: input.email.toLowerCase(),
    passwordHash: hashPassword(input.password),
  }).returning())[0];
  if (!user) throw new ApiError(500, "Não foi possível criar o usuário.");
  await assignPermissionKeys(user.id, input.permissionKeys);
  return context.json({ id: user.id }, 201);
});

app.patch("/api/users/:id", authentication, permissionRequired("users:update"), async (context) => {
  const userId = z.string().uuid().parse(context.req.param("id"));
  const input = await jsonBody(context, userUpdateSchema);
  if (input.permissionKeys) await assertKnownPermissionKeys(input.permissionKeys);
  const update: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) update.name = input.name;
  if (input.email !== undefined) update.email = input.email.toLowerCase();
  if (input.active !== undefined) update.active = input.active;
  if (input.password !== undefined) update.passwordHash = hashPassword(input.password);
  const user = (await db.update(users).set(update).where(eq(users.id, userId)).returning())[0];
  if (!user) throw new ApiError(404, "Usuário não encontrado.");
  if (input.permissionKeys) await assignPermissionKeys(userId, input.permissionKeys);
  return context.json({ id: user.id });
});

app.delete("/api/users/:id", authentication, permissionRequired("users:delete"), async (context) => {
  const userId = z.string().uuid().parse(context.req.param("id"));
  if (userId === context.get("currentUser").id) throw new ApiError(400, "O usuário não pode excluir a própria conta.");
  const deleted = await db.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
  if (deleted.length === 0) throw new ApiError(404, "Usuário não encontrado.");
  return context.body(null, 204);
});

app.get("/api/permissions", authentication, permissionRequired("permissions:read"), async (context) => {
  return context.json(await db.select().from(permissions).where(eq(permissions.system, true)).orderBy(asc(permissions.key)));
});

app.post("/api/dashboards/sync", authentication, adminRequired, async (context) => {
  return context.json(await syncDashboardDirectoryLocked());
});

app.post("/api/admin/dashboards", authentication, adminRequired, async (context) => {
  const input = await jsonBody(context, dashboardCreateSchema);
  let rollbackFile: (() => Promise<void>) | undefined;
  let dashboard: Awaited<ReturnType<typeof createDashboardFile>>["dashboard"];
  try {
    dashboard = await withDashboardFileCompensation(
      () => db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tcc-app:dashboard-files'))`);
        const created = await createDashboardFile(input, tx);
        rollbackFile = created.rollback;
        return created.dashboard;
      }),
      () => rollbackFile,
    );
  } catch (error) {
    if (error instanceof DashboardFileCompensationError) {
      console.error("[dashboard] new-file compensation failed after transaction error", {
        operationError: error.operationError,
        compensationError: error.compensationError,
      });
      throw new ApiError(500, "O cadastro do dashboard falhou e a remoção do arquivo também falhou. É necessária reconciliação administrativa.");
    }
    throw error;
  }
  rollbackFile = undefined;
  return context.json({ id: dashboard.id }, 201);
});

app.post("/api/admin/ai/dashboard-proposals/:id/commit", authentication, adminRequired, async (context) => {
  const currentUser = context.get("currentUser");
  const receiptId = z.string().uuid().parse(context.req.param("id"));
  const confirmation = await jsonBody(context, z.object({
    acknowledgeTruncation: z.boolean().default(false),
  }).strict());
  let rollbackFile: (() => Promise<void>) | undefined;
  try {
    const committed = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tcc-app:dashboard-files'))`);
      const receipt = (await tx.select().from(dashboardProposalReceipts)
        .where(eq(dashboardProposalReceipts.id, receiptId))
        .for("update").limit(1))[0];
      const now = new Date();
      if (!receipt) {
        throw new ApiError(409, "A proposta expirou, já foi aplicada ou pertence a outra sessão. Gere uma nova prévia.");
      }
      if (receipt.actorId !== currentUser.id) {
        throw new ApiError(409, "A proposta pertence a outra sessão. Gere uma nova prévia nesta sessão.");
      }
      if (receipt.consumedAt) {
        const current = (await tx.select().from(dashboards)
          .where(eq(dashboards.dashboardId, receipt.dashboardId))
          .for("update").limit(1))[0];
        if (current) {
          try {
            const persisted = dashboardDocumentSchema.parse(JSON.parse(await readFile(resolve(process.cwd(), current.filePath), "utf8")) as unknown);
            const persistedFingerprint = persisted.id === receipt.dashboardId
              ? dashboardDocumentFingerprint(persisted)
              : null;
            if (isDashboardProposalAlreadyApplied(receipt, currentUser.id, persistedFingerprint)) {
              return { id: receipt.dashboardId, mode: receipt.mode as "create" | "update", alreadyApplied: true };
            }
          } catch {
            // The receipt is only idempotent while its exact document is still persisted.
          }
        }
        throw new ApiError(409, "A proposta já foi consumida, mas o dashboard mudou desde a aplicação. Recarregue a tela.");
      }
      try {
        assertDashboardProposalUsable({ ...receipt, mode: receipt.mode as "create" | "update" }, currentUser.id, now);
      } catch {
        throw new ApiError(409, "A proposta expirou, já foi aplicada ou pertence a outra sessão. Gere uma nova prévia.");
      }
      try {
        assertDashboardPreviewAcknowledged(receipt.hasTruncatedPreview, confirmation.acknowledgeTruncation);
      } catch {
        throw new ApiError(400, "Confirme que revisou a prévia truncada antes de aplicar o dashboard.");
      }
      const document = dashboardDocumentSchema.parse(receipt.document);
      if (document.id !== receipt.dashboardId) {
        throw new ApiError(409, "O conteúdo da proposta não corresponde ao recibo. Gere uma nova prévia.");
      }
      const referenceIds = [...dashboardQueryReferences(document)];
      if (referenceIds.length === 0) throw new ApiError(409, "A proposta não possui queries salvas.");
      const queryRows = await tx.select({ query: savedQueries, source: dataSources })
        .from(savedQueries)
        .innerJoin(dataSources, eq(savedQueries.dataSourceId, dataSources.id))
        .where(inArray(savedQueries.id, referenceIds))
        .for("update");
      if (queryRows.length !== referenceIds.length) {
        throw new ApiError(409, "Uma query da proposta foi removida. Gere a prévia novamente.");
      }
      const referencesFingerprint = dashboardReferenceFingerprint(queryRows.map(({ query, source }) => ({
        queryId: query.id,
        queryUpdatedAt: query.updatedAt,
        dataSourceId: query.dataSourceId,
        sourceUpdatedAt: source.updatedAt,
        sourceTargetHash: querySourceTargetHash(source),
      })));
      try {
        buildDashboardDefinitionFromDocument(
          document,
          queryRows.map(({ query }): { id: string; parameters: unknown } => ({ id: query.id, parameters: query.parameters })),
          { validateCatalog: true },
        );
      } catch (error) {
        throw new ApiError(409, error instanceof Error ? error.message : "As referências do dashboard não são válidas.");
      }

      const target = (await tx.select().from(dashboards)
        .where(eq(dashboards.dashboardId, receipt.dashboardId))
        .for("update").limit(1))[0];
      let filePath: string;
      let currentDashboardFingerprint: string | null;
      if (receipt.mode === "create") {
        if (receipt.expectedDashboardFingerprint !== null || target) {
          throw new ApiError(409, "O dashboard já existe. Gere uma proposta de edição para a versão atual.");
        }
        currentDashboardFingerprint = null;
        filePath = resolve(process.cwd(), "dashboards", `${receipt.dashboardId}.json`);
        try {
          await readFile(filePath);
          throw new ApiError(409, "Já existe um arquivo com o identificador proposto. Gere outra prévia.");
        } catch (error) {
          if (error instanceof ApiError) throw error;
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      } else {
        if (!target || !receipt.expectedDashboardFingerprint) {
          throw new ApiError(409, "O dashboard foi removido depois da prévia. Gere outra proposta.");
        }
        filePath = resolve(process.cwd(), target.filePath);
        if (!isEditableDashboardFilePath(filePath)) throw new ApiError(409, "O arquivo do dashboard não está em um local editável.");
        let currentDocument;
        try {
          currentDocument = dashboardDocumentSchema.parse(JSON.parse(await readFile(filePath, "utf8")) as unknown);
        } catch {
          throw new ApiError(409, "Não foi possível verificar a versão atual do dashboard.");
        }
        if (currentDocument.id !== receipt.dashboardId) {
          throw new ApiError(409, "O dashboard foi editado depois da prévia. Recarregue-o e gere uma nova proposta.");
        }
        currentDashboardFingerprint = dashboardDocumentFingerprint(currentDocument);
      }

      try {
        assertDashboardProposalFresh({ ...receipt, mode: receipt.mode as "create" | "update" }, {
          documentFingerprint: dashboardDocumentFingerprint(document),
          referenceFingerprint: referencesFingerprint,
          dashboardFingerprint: currentDashboardFingerprint,
        });
      } catch {
        throw new ApiError(409, "O dashboard, uma query ou servidor mudou desde a prévia. Gere uma nova proposta.");
      }

      rollbackFile = await writeDashboardDocumentAtomically(filePath, document);
      if (receipt.mode === "create") {
        const storedPath = filePath.slice(process.cwd().length + 1);
        const inserted = await tx.insert(dashboards).values({
          dashboardId: receipt.dashboardId,
          filePath: storedPath,
        }).onConflictDoUpdate({
          target: dashboards.dashboardId,
          set: { filePath: storedPath },
          where: eq(dashboards.filePath, storedPath),
        }).returning({ dashboardId: dashboards.dashboardId });
        if (inserted.length === 0) throw new ApiError(409, "O identificador já está registrado por outro arquivo.");
      }
      await tx.update(dashboardProposalReceipts).set({ consumedAt: now })
        .where(and(eq(dashboardProposalReceipts.id, receipt.id), isNull(dashboardProposalReceipts.consumedAt)));
      return { id: receipt.dashboardId, mode: receipt.mode as "create" | "update", alreadyApplied: false };
    });
    rollbackFile = undefined;
    return context.json(committed, committed.mode === "create" && !committed.alreadyApplied ? 201 : 200);
  } catch (error) {
    let rollbackError: unknown;
    try {
      await rollbackFile?.();
    } catch (restoreError) {
      rollbackError = restoreError;
      console.error("[AI dashboard] file compensation failed after confirmation error", { error, restoreError });
    }
    if (rollbackError) {
      throw new ApiError(500, "A aplicação falhou e a restauração do arquivo também falhou. O dashboard precisa de reconciliação administrativa.");
    }
    if (error instanceof ApiError) throw error;
    console.error("[AI dashboard] confirmation failed", error);
    throw new ApiError(500, "Não foi possível aplicar a proposta do dashboard. As alterações em arquivo foram compensadas quando necessário; gere uma nova prévia.");
  }
});

app.get("/api/admin/dashboards/:id", authentication, adminRequired, async (context) => {
  const dashboardId = z.string().uuid().parse(context.req.param("id")).toLowerCase();
  const entry = (await getRegisteredDashboardFiles()).find((item) => item.dashboard.id === dashboardId);
  if (!entry) throw new ApiError(404, "Dashboard não encontrado.");
  return context.json({ document: entry.dashboard, revision: dashboardDocumentFingerprint(entry.dashboard) });
});

app.put("/api/admin/dashboards/:id", authentication, adminRequired, async (context) => {
  const dashboardId = z.string().uuid().parse(context.req.param("id")).toLowerCase();
  const input = await jsonBody(context, z.object({
    document: dashboardDocumentSchema,
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict());
  if (input.document.id !== dashboardId) throw new ApiError(400, "O id do dashboard não pode ser alterado.");
  let rollbackFile: (() => Promise<void>) | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tcc-app:dashboard-files'))`);
      const target = (await tx.select().from(dashboards)
        .where(eq(dashboards.dashboardId, dashboardId)).for("update").limit(1))[0];
      if (!target) throw new ApiError(404, "Dashboard não encontrado.");
      const filePath = resolve(process.cwd(), target.filePath);
      if (!isEditableDashboardFilePath(filePath)) throw new ApiError(400, "O dashboard só pode ser gravado dentro da pasta dashboards da aplicação.");
      let currentDocument;
      try {
        currentDocument = dashboardDocumentSchema.parse(JSON.parse(await readFile(filePath, "utf8")) as unknown);
      } catch {
        throw new ApiError(409, "Não foi possível verificar a versão atual do dashboard. Recarregue-o.");
      }
      if (dashboardDocumentFingerprint(currentDocument) !== input.expectedRevision) {
        throw new ApiError(409, "O dashboard foi editado por outra sessão. Recarregue e aplique suas alterações novamente.");
      }
      rollbackFile = await writeDashboardDocumentAtomically(filePath, input.document);
    });
  } catch (error) {
    let rollbackError: unknown;
    try {
      await rollbackFile?.();
    } catch (restoreError) {
      rollbackError = restoreError;
      console.error("[dashboard] file compensation failed after context update error", { error, restoreError });
    }
    if (rollbackError) {
      throw new ApiError(500, "A atualização falhou e a restauração do arquivo também falhou. O dashboard precisa de reconciliação administrativa.");
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, error instanceof Error ? error.message : "Não foi possível salvar o dashboard.");
  }
  rollbackFile = undefined;
  return context.json({ id: dashboardId, saved: true, revision: dashboardDocumentFingerprint(input.document) });
});

app.get("/api/admin/dashboards/:id/users", authentication, adminRequired, async (context) => {
  const dashboardId = z.string().uuid().parse(context.req.param("id")).toLowerCase();
  const dashboard = await getDashboardFileById(dashboardId);
  if (!dashboard) throw new ApiError(404, "Dashboard não encontrado.");
  const assigned = await db.select({ userId: dashboardUsers.userId }).from(dashboardUsers).where(eq(dashboardUsers.dashboardId, dashboardId));
  const availableUsers = await db.select({ id: users.id, name: users.name, email: users.email, active: users.active })
    .from(users)
    .orderBy(asc(users.name));
  return context.json({ users: availableUsers, userIds: assigned.map((assignment) => assignment.userId) });
});

app.put("/api/admin/dashboards/:id/users", authentication, adminRequired, async (context) => {
  const dashboardId = z.string().uuid().parse(context.req.param("id")).toLowerCase();
  const dashboard = await getDashboardFileById(dashboardId);
  if (!dashboard) throw new ApiError(404, "Dashboard não encontrado.");
  const input = await jsonBody(context, z.object({ userIds: z.array(z.string().uuid()) }).strict());
  const uniqueUserIds = [...new Set(input.userIds)];
  if (uniqueUserIds.length !== input.userIds.length) throw new ApiError(400, "Não repita usuários na lista de acesso do dashboard.");
  const knownUsers = uniqueUserIds.length === 0 ? [] : await db.select({ id: users.id }).from(users).where(inArray(users.id, uniqueUserIds));
  if (knownUsers.length !== uniqueUserIds.length) throw new ApiError(400, "Um ou mais usuários selecionados não existem.");
  await db.transaction(async (tx) => {
    await tx.delete(dashboardUsers).where(eq(dashboardUsers.dashboardId, dashboardId));
    if (uniqueUserIds.length > 0) {
      await tx.insert(dashboardUsers).values(uniqueUserIds.map((userId) => ({ dashboardId, userId })));
    }
  });
  return context.json({ dashboardId, userIds: uniqueUserIds });
});

async function catalogSourceTables(
  sourceId: string,
  tables: Awaited<ReturnType<typeof inspectReadOnlyPostgres>>,
  options: {
    sourceUpdate?: CatalogSourceUpdate;
    expectedSourceSnapshot?: CatalogSourceSnapshot;
    resetTableContexts?: boolean;
  } = {},
): Promise<void> {
  try {
    await reconcileDataSourceCatalog({
      transaction: (work) => db.transaction(async (tx) => work({
      async lockDataSource(dataSourceId) {
        const row = (await tx.select({
          name: dataSources.name,
          host: dataSources.host,
          port: dataSources.port,
          databaseName: dataSources.databaseName,
          username: dataSources.username,
          encryptedPassword: dataSources.encryptedPassword,
          context: dataSources.context,
          updatedAt: dataSources.updatedAt,
        })
          .from(dataSources)
          .where(eq(dataSources.id, dataSourceId))
          .for("update")
          .limit(1))[0];
        if (!row) throw new ApiError(404, "Servidor PostgreSQL não encontrado para atualizar o catálogo.");
        return row;
      },
      async updateDataSource(dataSourceId, update) {
        const row = (await tx.update(dataSources)
          .set(update)
          .where(eq(dataSources.id, dataSourceId))
          .returning({ id: dataSources.id }))[0];
        if (!row) throw new ApiError(404, "Servidor PostgreSQL não encontrado.");
      },
      listCatalogEntries(dataSourceId, limit) {
        return tx.select({
          id: dataSourceTables.id,
          schemaName: dataSourceTables.schemaName,
          tableName: dataSourceTables.tableName,
        }).from(dataSourceTables)
          .where(eq(dataSourceTables.dataSourceId, dataSourceId))
          .limit(limit);
      },
      async upsertCatalogEntries(dataSourceId, discoveredTables, discoveredAt, resetContexts) {
        await tx.insert(dataSourceTables).values(discoveredTables.map((table) => ({
          dataSourceId,
          ...table,
          discoveredAt,
        }))).onConflictDoUpdate({
          target: [dataSourceTables.dataSourceId, dataSourceTables.schemaName, dataSourceTables.tableName],
          // Keep human-authored table context on unchanged identities.
          set: resetContexts ? { discoveredAt, context: "" } : { discoveredAt },
        });
      },
      async deleteCatalogEntries(dataSourceId, tableIds) {
        await tx.delete(dataSourceTables).where(and(
          eq(dataSourceTables.dataSourceId, dataSourceId),
          inArray(dataSourceTables.id, tableIds),
        ));
      },
      })),
    }, sourceId, tables, new Date(), options);
  } catch (error) {
    if (error instanceof DataSourceCatalogSnapshotChangedError) {
      throw new ApiError(409, "O servidor foi alterado durante a operação. Tente atualizar o catálogo novamente.");
    }
    throw error;
  }
}

app.get("/api/data-sources", authentication, permissionRequired("data-sources:read"), async (context) => {
  const sources = await db.select().from(dataSources).orderBy(asc(dataSources.name));
  return context.json(sources.map(safeSource));
});

app.get("/api/data-sources/:id", authentication, permissionRequired("data-sources:read"), async (context) => {
  const source = await getSourceOrThrow(z.string().uuid().parse(context.req.param("id")));
  const tables = await db.select().from(dataSourceTables)
    .where(eq(dataSourceTables.dataSourceId, source.id))
    .orderBy(asc(dataSourceTables.schemaName), asc(dataSourceTables.tableName))
    .limit(MAX_DATA_SOURCE_CATALOG_TABLES + 1);
  if (tables.length > MAX_DATA_SOURCE_CATALOG_TABLES) {
    throw new ApiError(409, `O catálogo excede o limite de ${MAX_DATA_SOURCE_CATALOG_TABLES} tabelas; contate um administrador.`);
  }
  return context.json({ ...safeSource(source), tables });
});

app.post("/api/data-sources/test", authentication, permissionRequired("data-sources:create"), async (context) => {
  const input = await jsonBody(context, sourceInputSchema);
  const tables = await inspectReadOnlyPostgres({ host: input.host, port: input.port, database: input.databaseName, user: input.username, password: input.password });
  return context.json({ valid: true, tables });
});

app.post("/api/data-sources", authentication, permissionRequired("data-sources:create"), async (context: AppContext) => {
  const input = await jsonBody(context, sourceInputSchema);
  const tables = await inspectReadOnlyPostgres({ host: input.host, port: input.port, database: input.databaseName, user: input.username, password: input.password });
  const source = (await db.insert(dataSources).values({
    name: input.name,
    host: input.host,
    port: input.port,
    databaseName: input.databaseName,
    username: input.username,
    encryptedPassword: encryptCredential(input.password, environment.CREDENTIAL_ENCRYPTION_KEY),
    context: input.context,
    createdBy: context.get("currentUser").id,
  }).returning())[0];
  if (!source) throw new ApiError(500, "Não foi possível salvar o servidor PostgreSQL.");
  await catalogSourceTables(source.id, tables);
  return context.json({ ...safeSource(source), tables }, 201);
});

app.patch("/api/data-sources/:id", authentication, permissionRequired("data-sources:update"), async (context) => {
  const sourceId = z.string().uuid().parse(context.req.param("id"));
  const input = await jsonBody(context, sourceUpdateInputSchema);
  const existing = await getSourceOrThrow(sourceId);
  const expectedSourceSnapshot = catalogSourceSnapshot(existing);
  const password = input.password ?? sourceConnection(existing).password;
  const discovered = await inspectReadOnlyPostgres({ host: input.host, port: input.port, database: input.databaseName, user: input.username, password });
  const targetChanged = hasDataSourceTargetChanged(existing, input);
  const sourceUpdate: CatalogSourceUpdate = {
    name: input.name,
    host: input.host,
    port: input.port,
    databaseName: input.databaseName,
    username: input.username,
    encryptedPassword: encryptCredential(password, environment.CREDENTIAL_ENCRYPTION_KEY),
    context: input.context,
    // Keep this token strictly increasing even when edits land within one ms.
    updatedAt: new Date(Math.max(Date.now(), expectedSourceSnapshot.updatedAt.getTime() + 1)),
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
});

app.post("/api/data-sources/:id/refresh", authentication, permissionRequired("data-sources:update"), async (context) => {
  const source = await getSourceOrThrow(z.string().uuid().parse(context.req.param("id")));
  const expectedSourceSnapshot = catalogSourceSnapshot(source);
  const tables = await inspectReadOnlyPostgres(sourceConnection(source));
  await catalogSourceTables(source.id, tables, { expectedSourceSnapshot });
  return context.json({ tables });
});

app.patch("/api/data-sources/:sourceId/tables/:tableId", authentication, permissionRequired("data-sources:update"), async (context) => {
  const sourceId = z.string().uuid().parse(context.req.param("sourceId"));
  const tableId = z.string().uuid().parse(context.req.param("tableId"));
  const input = await jsonBody(context, z.object({
    context: z.string().max(20000),
    expectedSourceUpdatedAt: z.string().datetime(),
  }).strict());
  let table: typeof dataSourceTables.$inferSelect | undefined;
  try {
    table = await updateTableContextIfSourceVersionMatches<typeof dataSourceTables.$inferSelect>({
      transaction: (work) => db.transaction((tx) => work({
        async lockSourceUpdatedAt(dataSourceId) {
          const row = (await tx.select({ updatedAt: dataSources.updatedAt })
            .from(dataSources)
            .where(eq(dataSources.id, dataSourceId))
            .for("update")
            .limit(1))[0];
          return row?.updatedAt;
        },
        async updateTableContext(dataSourceId, targetTableId, tableContext) {
          return (await tx.update(dataSourceTables)
            .set({ context: tableContext })
            .where(and(eq(dataSourceTables.id, targetTableId), eq(dataSourceTables.dataSourceId, dataSourceId)))
            .returning())[0];
        },
      })),
    }, sourceId, tableId, input.context, input.expectedSourceUpdatedAt);
  } catch (error) {
    if (error instanceof DataSourceContextVersionConflictError) {
      throw new ApiError(409, "O servidor foi alterado. Recarregue os dados antes de salvar o contexto.");
    }
    if (error instanceof DataSourceContextSourceNotFoundError) {
      throw new ApiError(404, "Servidor PostgreSQL não encontrado.");
    }
    throw error;
  }
  if (!table) throw new ApiError(404, "Tabela catalogada não encontrada.");
  return context.json(table);
});

app.delete("/api/data-sources/:id", authentication, permissionRequired("data-sources:delete"), async (context) => {
  const sourceId = z.string().uuid().parse(context.req.param("id"));
  await getSourceOrThrow(sourceId);
  const deleted = await db.transaction(async (tx) => {
    await tx.delete(savedQueries).where(eq(savedQueries.dataSourceId, sourceId));
    return tx.delete(dataSources).where(eq(dataSources.id, sourceId)).returning({ id: dataSources.id });
  });
  if (deleted.length === 0) throw new ApiError(404, "Servidor PostgreSQL não encontrado.");
  return context.body(null, 204);
});

app.get("/api/queries", authentication, permissionRequired("queries:read"), async (context) => {
  return context.json(await db.select({
    id: savedQueries.id,
    dataSourceId: savedQueries.dataSourceId,
    name: savedQueries.name,
    parameters: savedQueries.parameters,
    createdAt: savedQueries.createdAt,
    updatedAt: savedQueries.updatedAt,
  }).from(savedQueries).orderBy(asc(savedQueries.name)));
});

app.get("/api/queries/:id", authentication, permissionRequired("queries:read"), async (context) => {
  return context.json(await getQueryOrThrow(z.string().uuid().parse(context.req.param("id"))));
});

app.post("/api/queries/test", authentication, async (context: AppContext) => {
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
    queryTarget = (await db.select().from(savedQueries)
      .where(eq(savedQueries.id, input.queryId!))
      .limit(1))[0];
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
    queryLifecycleApiError(error);
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
});

app.post("/api/queries", authentication, permissionRequired("queries:create"), async (context: AppContext) => {
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
    queryLifecycleApiError(error);
  }
  return context.json(query, 201);
});

app.patch("/api/queries/:id", authentication, permissionRequired("queries:update"), async (context) => {
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
    queryLifecycleApiError(error);
  }
  return context.json(query);
});

app.post("/api/queries/:id/test", authentication, permissionRequired("queries:update"), async (context) => {
  const query = await getQueryOrThrow(z.string().uuid().parse(context.req.param("id")));
  const body = await jsonBody(context, z.object({ parameters: z.record(z.union([z.string(), z.array(z.string())])).default({}) }));
  return context.json({ rows: await runQueryDefinition({
    dataSourceId: query.dataSourceId,
    sqlText: query.sqlText,
    parameters: parseParameters(query.parameters),
    values: body.parameters,
  }) });
});

app.delete("/api/queries/:id", authentication, permissionRequired("queries:delete"), async (context) => {
  const queryId = z.string().uuid().parse(context.req.param("id"));
  const dashboardFiles = await getDashboardFiles();
  const isReferenced = dashboardFiles.some(({ dashboard }) => dashboardQueryReferences(dashboard).has(queryId));
  if (isReferenced) throw new ApiError(400, "Remova as referências do dashboard (componentes, lookups e mapeamentos) antes de excluir a query.");
  await getQueryOrThrow(queryId);
  await db.delete(savedQueries).where(eq(savedQueries.id, queryId));
  return context.body(null, 204);
});

app.get("/api/dashboards", authentication, async (context: AppContext) => {
  await syncDashboardDirectoryLocked();
  const currentUser = context.get("currentUser");
  const accessibleDashboards = await getAccessibleDashboards(currentUser);
  return context.json(accessibleDashboards.map((dashboard) => ({
    id: dashboard.id,
    name: dashboard.name,
    description: dashboard.description ?? null,
  })));
});

app.get("/api/dashboards/:id", authentication, async (context: AppContext) => {
  const dashboardId = z.string().uuid().parse(context.req.param("id")).toLowerCase();
  const dashboard = (await getRegisteredDashboards()).find((item) => item.id === dashboardId);
  if (!dashboard) throw new ApiError(404, "Dashboard não encontrado.");
  const currentUser = context.get("currentUser");
  await assertDashboardAccess(currentUser, dashboardId);
  const queryIds = [...dashboardQueryReferences(dashboard)];
  const catalogQueries = queryIds.length
    ? await db.select({ id: savedQueries.id, parameters: savedQueries.parameters }).from(savedQueries).where(inArray(savedQueries.id, queryIds))
    : [];
  let definition;
  try {
    definition = buildDashboardDefinitionFromDocument(dashboard, catalogQueries, { validateCatalog: false });
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : "O dashboard possui referências inválidas.");
  }
  return context.json({
    id: dashboard.id,
    name: dashboard.name,
    description: dashboard.description ?? null,
    definition,
  });
});

app.get("/query/:uuid", authentication, async (context: AppContext) => {
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
});

export { app };
