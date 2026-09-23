import { randomUUID } from "node:crypto";
import { Hono, type Context, type Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { and, asc, eq, inArray } from "drizzle-orm";
import { ZodError, z } from "zod";
import { getEnvironment } from "./config.js";
import { db } from "./db/client.js";
import { dashboards, dataSources, dataSourceTables, permissions, savedQueries, userPermissions, users } from "./db/schema.js";
import {
  dashboardDefinitionSchema,
  dashboardInputSchema,
  passwordSchema,
  permissionKeySchema,
  parameterDefinitionSchema,
  queryInputSchema,
  sourceInputSchema,
  sourceUpdateInputSchema,
  type DashboardDefinition,
  type ParameterDefinition,
} from "./lib/contracts.js";
import { decryptCredential, encryptCredential } from "./lib/credentials.js";
import { hashPassword, verifyPassword } from "./lib/passwords.js";
import { inspectReadOnlyPostgres, runReadOnlyQuery, type ExternalPostgresConfig } from "./services/external-postgres.js";
import { createSession, findAuthenticatedUser, hasPermission, revokeSession, SESSION_COOKIE, type AuthenticatedUser } from "./services/auth.js";
import { assignPermissionKeys, createResourcePermission, grantPermissionKeys } from "./services/permissions.js";
import { assertParameterDefinitions, assertReadOnlySql, bindQueryParameters } from "./services/query-security.js";

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
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
}));

app.onError((error, context) => {
  if (error instanceof ApiError) return context.json({ error: error.message }, error.status as never);
  if (error instanceof ZodError) return context.json({ error: "Dados inválidos.", details: error.flatten() }, 400);
  console.error(error);
  return context.json({ error: "Erro interno do servidor." }, 500);
});

app.get("/api/health", (context) => context.json({ status: "ok", timestamp: new Date().toISOString() }));

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

function resourcePermission(kind: "dashboard" | "query", id: string, action: "view" | "execute"): string {
  return `${kind}:${id}:${action}`;
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

function safeSource(source: typeof dataSources.$inferSelect) {
  const { encryptedPassword: _encryptedPassword, ...safe } = source;
  return safe;
}

function parseParameters(value: unknown): ParameterDefinition[] {
  return z.array(parameterDefinitionSchema).parse(value);
}

function parsePermissionKeys(value: unknown): string[] {
  return z.array(permissionKeySchema).parse(value);
}

function validateQueryInput(input: z.infer<typeof queryInputSchema>): void {
  assertReadOnlySql(input.sqlText);
  assertParameterDefinitions(input.parameters);
}

async function assertKnownPermissionKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const known = await db.select({ key: permissions.key }).from(permissions).where(inArray(permissions.key, keys));
  if (known.length !== keys.length) throw new ApiError(400, "Uma ou mais permissões obrigatórias não existem no catálogo.");
}

async function getDashboardOrThrow(dashboardId: string) {
  const dashboard = (await db.select().from(dashboards).where(eq(dashboards.id, dashboardId)).limit(1))[0];
  if (!dashboard) throw new ApiError(404, "Dashboard não encontrado.");
  return dashboard;
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

async function validateDashboardDefinition(dashboardId: string, definition: DashboardDefinition): Promise<void> {
  const queryIds = [...new Set(definition.components.map((component) => component.queryUuid))];
  if (queryIds.length === 0) return;
  const matched = await db.select({ id: savedQueries.id, dashboardId: savedQueries.dashboardId })
    .from(savedQueries)
    .where(inArray(savedQueries.id, queryIds));
  if (matched.length !== queryIds.length || matched.some((query) => query.dashboardId !== dashboardId)) {
    throw new ApiError(400, "Todo componente deve referenciar uma query existente do próprio dashboard.");
  }
}

function definitionForUser(definition: DashboardDefinition, availableQueryIds: Set<string>): DashboardDefinition {
  return {
    ...definition,
    components: definition.components.filter((component) => availableQueryIds.has(component.queryUuid)),
  };
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

const permissionInputSchema = z.object({
  key: permissionKeySchema,
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(20000).nullable().optional(),
});

app.get("/api/permissions", authentication, permissionRequired("permissions:read"), async (context) => {
  return context.json(await db.select().from(permissions).orderBy(asc(permissions.key)));
});

app.post("/api/permissions", authentication, permissionRequired("permissions:create"), async (context) => {
  const input = await jsonBody(context, permissionInputSchema);
  const permission = (await db.insert(permissions).values({ ...input, system: false }).returning())[0];
  if (!permission) throw new ApiError(500, "Não foi possível criar a permissão.");
  return context.json(permission, 201);
});

app.patch("/api/permissions/:id", authentication, permissionRequired("permissions:update"), async (context) => {
  const permissionId = z.string().uuid().parse(context.req.param("id"));
  const input = await jsonBody(context, permissionInputSchema.omit({ key: true }).partial());
  const existing = (await db.select().from(permissions).where(eq(permissions.id, permissionId)).limit(1))[0];
  if (!existing) throw new ApiError(404, "Permissão não encontrada.");
  if (existing.system) throw new ApiError(400, "Permissões do sistema e de recursos não podem ser alteradas.");
  const permission = (await db.update(permissions).set(input).where(eq(permissions.id, permissionId)).returning())[0];
  return context.json(permission);
});

app.delete("/api/permissions/:id", authentication, permissionRequired("permissions:delete"), async (context) => {
  const permissionId = z.string().uuid().parse(context.req.param("id"));
  const existing = (await db.select().from(permissions).where(eq(permissions.id, permissionId)).limit(1))[0];
  if (!existing) throw new ApiError(404, "Permissão não encontrada.");
  if (existing.system) throw new ApiError(400, "Permissões do sistema e de recursos não podem ser excluídas.");
  await db.delete(permissions).where(eq(permissions.id, permissionId));
  return context.body(null, 204);
});

async function catalogSourceTables(sourceId: string, tables: Awaited<ReturnType<typeof inspectReadOnlyPostgres>>): Promise<void> {
  for (const table of tables) {
    await db.insert(dataSourceTables).values({ dataSourceId: sourceId, ...table }).onConflictDoUpdate({
      target: [dataSourceTables.dataSourceId, dataSourceTables.schemaName, dataSourceTables.tableName],
      set: { discoveredAt: new Date() },
    });
  }
}

app.get("/api/data-sources", authentication, permissionRequired("data-sources:read"), async (context) => {
  const sources = await db.select().from(dataSources).orderBy(asc(dataSources.name));
  return context.json(sources.map(safeSource));
});

app.get("/api/data-sources/:id", authentication, permissionRequired("data-sources:read"), async (context) => {
  const source = await getSourceOrThrow(z.string().uuid().parse(context.req.param("id")));
  const tables = await db.select().from(dataSourceTables).where(eq(dataSourceTables.dataSourceId, source.id)).orderBy(asc(dataSourceTables.schemaName), asc(dataSourceTables.tableName));
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
  const password = input.password ?? sourceConnection(existing).password;
  const discovered = await inspectReadOnlyPostgres({ host: input.host, port: input.port, database: input.databaseName, user: input.username, password });
  const source = (await db.update(dataSources).set({
    name: input.name,
    host: input.host,
    port: input.port,
    databaseName: input.databaseName,
    username: input.username,
    encryptedPassword: encryptCredential(password, environment.CREDENTIAL_ENCRYPTION_KEY),
    context: input.context,
    updatedAt: new Date(),
  }).where(eq(dataSources.id, sourceId)).returning())[0];
  if (!source) throw new ApiError(404, "Servidor PostgreSQL não encontrado.");
  await catalogSourceTables(source.id, discovered);
  return context.json(safeSource(source));
});

app.post("/api/data-sources/:id/refresh", authentication, permissionRequired("data-sources:update"), async (context) => {
  const source = await getSourceOrThrow(z.string().uuid().parse(context.req.param("id")));
  const tables = await inspectReadOnlyPostgres(sourceConnection(source));
  await catalogSourceTables(source.id, tables);
  return context.json({ tables });
});

app.patch("/api/data-sources/:sourceId/tables/:tableId", authentication, permissionRequired("data-sources:update"), async (context) => {
  const sourceId = z.string().uuid().parse(context.req.param("sourceId"));
  const tableId = z.string().uuid().parse(context.req.param("tableId"));
  const input = await jsonBody(context, z.object({ context: z.string().max(20000) }));
  const table = (await db.update(dataSourceTables).set({ context: input.context }).where(and(eq(dataSourceTables.id, tableId), eq(dataSourceTables.dataSourceId, sourceId))).returning())[0];
  if (!table) throw new ApiError(404, "Tabela catalogada não encontrada.");
  return context.json(table);
});

app.delete("/api/data-sources/:id", authentication, permissionRequired("data-sources:delete"), async (context) => {
  const sourceId = z.string().uuid().parse(context.req.param("id"));
  const deleted = await db.delete(dataSources).where(eq(dataSources.id, sourceId)).returning({ id: dataSources.id });
  if (deleted.length === 0) throw new ApiError(404, "Servidor PostgreSQL não encontrado.");
  return context.body(null, 204);
});

app.get("/api/queries", authentication, permissionRequired("queries:read"), async (context) => {
  return context.json(await db.select({
    id: savedQueries.id,
    dashboardId: savedQueries.dashboardId,
    dataSourceId: savedQueries.dataSourceId,
    name: savedQueries.name,
    parameters: savedQueries.parameters,
    requiredPermissionKeys: savedQueries.requiredPermissionKeys,
    createdAt: savedQueries.createdAt,
    updatedAt: savedQueries.updatedAt,
  }).from(savedQueries).orderBy(asc(savedQueries.name)));
});

app.get("/api/queries/:id", authentication, permissionRequired("queries:read"), async (context) => {
  const query = await getQueryOrThrow(z.string().uuid().parse(context.req.param("id")));
  return context.json(query);
});

app.post("/api/queries", authentication, permissionRequired("queries:create"), async (context: AppContext) => {
  const input = await jsonBody(context, queryInputSchema);
  validateQueryInput(input);
  await getDashboardOrThrow(input.dashboardId);
  await getSourceOrThrow(input.dataSourceId);
  await assertKnownPermissionKeys(input.requiredPermissionKeys);
  const queryId = randomUUID();
  const executePermission = resourcePermission("query", queryId, "execute");
  await createResourcePermission(executePermission, `Executar query: ${input.name}`, "Permite hidratar os componentes vinculados a esta query.");
  const query = (await db.insert(savedQueries).values({ id: queryId, ...input, createdBy: context.get("currentUser").id }).returning())[0];
  if (!query) throw new ApiError(500, "Não foi possível criar a query.");
  await grantPermissionKeys(context.get("currentUser").id, [executePermission]);
  return context.json(query, 201);
});

app.patch("/api/queries/:id", authentication, permissionRequired("queries:update"), async (context) => {
  const queryId = z.string().uuid().parse(context.req.param("id"));
  const input = await jsonBody(context, queryInputSchema);
  validateQueryInput(input);
  await getDashboardOrThrow(input.dashboardId);
  await getSourceOrThrow(input.dataSourceId);
  await assertKnownPermissionKeys(input.requiredPermissionKeys);
  const query = (await db.update(savedQueries).set({ ...input, updatedAt: new Date() }).where(eq(savedQueries.id, queryId)).returning())[0];
  if (!query) throw new ApiError(404, "Query não encontrada.");
  return context.json(query);
});

app.post("/api/queries/:id/test", authentication, permissionRequired("queries:update"), async (context) => {
  const query = await getQueryOrThrow(z.string().uuid().parse(context.req.param("id")));
  const source = await getSourceOrThrow(query.dataSourceId);
  const body = await jsonBody(context, z.object({ parameters: z.record(z.union([z.string(), z.array(z.string())])).default({}) }));
  const bound = bindQueryParameters(query.sqlText, parseParameters(query.parameters), body.parameters);
  const rows = await runReadOnlyQuery(sourceConnection(source), bound.sqlText, bound.values);
  return context.json({ rows });
});

app.delete("/api/queries/:id", authentication, permissionRequired("queries:delete"), async (context) => {
  const queryId = z.string().uuid().parse(context.req.param("id"));
  const query = await getQueryOrThrow(queryId);
  const dashboardsWithQuery = await db.select().from(dashboards);
  const isReferenced = dashboardsWithQuery.some((dashboard) => dashboardDefinitionSchema.parse(dashboard.definition).components.some((component) => component.queryUuid === query.id));
  if (isReferenced) throw new ApiError(400, "Remova a referência ao componente antes de excluir a query.");
  await db.delete(savedQueries).where(eq(savedQueries.id, queryId));
  await db.delete(permissions).where(eq(permissions.key, resourcePermission("query", queryId, "execute")));
  return context.body(null, 204);
});

app.get("/api/dashboards", authentication, async (context: AppContext) => {
  const currentUser = context.get("currentUser");
  const allDashboards = await db.select().from(dashboards).orderBy(asc(dashboards.name));
  return context.json(allDashboards
    .filter((dashboard) => hasPermission(currentUser, resourcePermission("dashboard", dashboard.id, "view")))
    .map(({ id, name, description, createdAt, updatedAt }) => ({ id, name, description, createdAt, updatedAt })));
});

app.get("/api/admin/dashboards", authentication, permissionRequired("dashboards:read"), async (context) => {
  return context.json(await db.select().from(dashboards).orderBy(asc(dashboards.name)));
});

app.post("/api/dashboards", authentication, permissionRequired("dashboards:create"), async (context: AppContext) => {
  const input = await jsonBody(context, dashboardInputSchema);
  const dashboardId = randomUUID();
  await validateDashboardDefinition(dashboardId, input.definition);
  const viewPermission = resourcePermission("dashboard", dashboardId, "view");
  await createResourcePermission(viewPermission, `Visualizar dashboard: ${input.name}`, "Permite abrir este dashboard.");
  const dashboard = (await db.insert(dashboards).values({ id: dashboardId, ...input, createdBy: context.get("currentUser").id }).returning())[0];
  if (!dashboard) throw new ApiError(500, "Não foi possível criar o dashboard.");
  await grantPermissionKeys(context.get("currentUser").id, [viewPermission]);
  return context.json(dashboard, 201);
});

app.patch("/api/dashboards/:id", authentication, permissionRequired("dashboards:update"), async (context) => {
  const dashboardId = z.string().uuid().parse(context.req.param("id"));
  const input = await jsonBody(context, dashboardInputSchema);
  await validateDashboardDefinition(dashboardId, input.definition);
  const dashboard = (await db.update(dashboards).set({ ...input, updatedAt: new Date() }).where(eq(dashboards.id, dashboardId)).returning())[0];
  if (!dashboard) throw new ApiError(404, "Dashboard não encontrado.");
  return context.json(dashboard);
});

app.delete("/api/dashboards/:id", authentication, permissionRequired("dashboards:delete"), async (context) => {
  const dashboardId = z.string().uuid().parse(context.req.param("id"));
  const dashboard = await getDashboardOrThrow(dashboardId);
  const definition = dashboardDefinitionSchema.parse(dashboard.definition);
  if (definition.components.length > 0) throw new ApiError(400, "Remova os componentes do dashboard antes de excluí-lo.");
  const queries = await db.select({ id: savedQueries.id }).from(savedQueries).where(eq(savedQueries.dashboardId, dashboardId));
  if (queries.length > 0) throw new ApiError(400, "Exclua as queries do dashboard antes de removê-lo.");
  await db.delete(dashboards).where(eq(dashboards.id, dashboardId));
  await db.delete(permissions).where(eq(permissions.key, resourcePermission("dashboard", dashboardId, "view")));
  return context.body(null, 204);
});

app.get("/api/dashboards/:id", authentication, async (context: AppContext) => {
  const dashboard = await getDashboardOrThrow(z.string().uuid().parse(context.req.param("id")));
  const currentUser = context.get("currentUser");
  if (!hasPermission(currentUser, resourcePermission("dashboard", dashboard.id, "view"))) {
    throw new ApiError(403, "O usuário não possui acesso a este dashboard.");
  }
  const queries = await db.select({ id: savedQueries.id, parameters: savedQueries.parameters, requiredPermissionKeys: savedQueries.requiredPermissionKeys })
    .from(savedQueries)
    .where(eq(savedQueries.dashboardId, dashboard.id));
  const allowedQueryIds = new Set(queries
    .filter((query) => hasPermission(currentUser, resourcePermission("query", query.id, "execute")) && parsePermissionKeys(query.requiredPermissionKeys).every((key) => hasPermission(currentUser, key)))
    .map((query) => query.id));
  const definition = definitionForUser(dashboardDefinitionSchema.parse(dashboard.definition), allowedQueryIds);
  return context.json({
    id: dashboard.id,
    name: dashboard.name,
    description: dashboard.description,
    definition,
    queryParameters: queries
      .filter((query) => allowedQueryIds.has(query.id))
      .map((query) => ({ queryUuid: query.id, parameters: parseParameters(query.parameters) })),
  });
});

app.get("/query/:uuid", authentication, async (context: AppContext) => {
  const query = await getQueryOrThrow(z.string().uuid().parse(context.req.param("uuid")));
  const currentUser = context.get("currentUser");
  const dashboardPermission = resourcePermission("dashboard", query.dashboardId, "view");
  const queryPermission = resourcePermission("query", query.id, "execute");
  if (!hasPermission(currentUser, dashboardPermission) || !hasPermission(currentUser, queryPermission)) {
    throw new ApiError(403, "O usuário não possui autorização para executar esta query.");
  }
  const requiredPermissions = parsePermissionKeys(query.requiredPermissionKeys);
  if (!requiredPermissions.every((key) => hasPermission(currentUser, key))) {
    throw new ApiError(403, "O usuário não possui as permissões de negócio necessárias para esta query.");
  }
  const parameters = parseParameters(query.parameters);
  const rawParameters: Record<string, string | string[] | undefined> = {};
  const url = new URL(context.req.url);
  for (const name of new Set([...url.searchParams.keys()])) {
    const values = url.searchParams.getAll(name);
    rawParameters[name] = values.length > 1 ? values : values[0];
  }
  const bound = bindQueryParameters(query.sqlText, parameters, rawParameters);
  const source = await getSourceOrThrow(query.dataSourceId);
  const rows = await runReadOnlyQuery(sourceConnection(source), bound.sqlText, bound.values);
  return context.json({ rows });
});

export { app };
