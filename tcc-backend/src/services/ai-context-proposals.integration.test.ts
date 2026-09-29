import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { getEnvironment } from "../config.js";
import { db, pool } from "../db/client.js";
import { aiContextProposals, dataSourceTables, dataSources, users } from "../db/schema.js";
import { encryptCredential } from "../lib/credentials.js";
import { createSession } from "./auth.js";

const integrationDescribe = describe.runIf(process.env.TCC_POSTGRES_INTEGRATION === "1");
const smokePassword = randomUUID().replaceAll("-", "");
const databaseUrl = new URL(process.env.DATABASE_URL ?? "postgres://localhost/undefined");
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
const databasePort = Number(databaseUrl.port || "5432");
const externalDatabasePort = Number(process.env.TCC_SMOKE_EXTERNAL_PORT || databasePort);
const readerRole = `tcc_context_reader_${randomUUID().replaceAll("-", "").slice(0, 16)}`;

type SmokeUser = { id: string; token: string };

async function createUser(isAdmin: boolean): Promise<SmokeUser> {
  const user = (await db.insert(users).values({
    name: isAdmin ? "Context smoke admin" : "Context smoke user",
    email: `${randomUUID()}@example.test`,
    passwordHash: "unused-in-route-smoke",
    isAdmin,
  }).returning({ id: users.id }))[0];
  if (!user) throw new Error("Could not create an integration test user.");
  return { id: user.id, token: (await createSession(user.id)).token };
}

async function jsonRequest(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers();
  if (options.token) headers.set("Cookie", `tcc_session=${options.token}`);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  return await app.request(`http://localhost${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function createSourceProposal(input: {
  actorId: string;
  sourceId: string;
  sourceName: string;
  currentContext: string;
  contextVersion: number;
  proposedContext: string;
}) {
  return (await db.insert(aiContextProposals).values({
    actorId: input.actorId,
    targetType: "source",
    dataSourceId: input.sourceId,
    tableId: null,
    sourceName: input.sourceName,
    schemaName: null,
    tableName: null,
    baseContextVersion: input.contextVersion,
    currentContext: input.currentContext,
    proposedContext: input.proposedContext,
    reason: "Integration test proposal",
    expiresAt: new Date(Date.now() + 5 * 60_000),
  }).returning({ id: aiContextProposals.id }))[0]!;
}

async function createTableProposal(input: {
  actorId: string;
  sourceId: string;
  sourceName: string;
  tableId: string;
  currentContext: string;
  contextVersion: number;
  proposedContext: string;
}) {
  return (await db.insert(aiContextProposals).values({
    actorId: input.actorId,
    targetType: "table",
    dataSourceId: input.sourceId,
    tableId: input.tableId,
    sourceName: input.sourceName,
    schemaName: "public",
    tableName: "users",
    baseContextVersion: input.contextVersion,
    currentContext: input.currentContext,
    proposedContext: input.proposedContext,
    reason: "Integration test proposal",
    expiresAt: new Date(Date.now() + 5 * 60_000),
  }).returning({ id: aiContextProposals.id }))[0]!;
}

integrationDescribe("context proposal routes with disposable PostgreSQL", () => {
  let owner: SmokeUser;
  let otherAdmin: SmokeUser;
  let regularUser: SmokeUser;
  let source: typeof dataSources.$inferSelect;
  let table: typeof dataSourceTables.$inferSelect;
  const sourceIds: string[] = [];

  beforeAll(async () => {
    owner = await createUser(true);
    otherAdmin = await createUser(true);
    regularUser = await createUser(false);
    source = (await db.insert(dataSources).values({
      name: `context-route-${randomUUID()}`,
      host: "unused.invalid",
      port: 5432,
      databaseName,
      username: "unused",
      encryptedPassword: "unused",
      context: "Existing source context",
      createdBy: owner.id,
    }).returning())[0]!;
    sourceIds.push(source.id);
    table = (await db.insert(dataSourceTables).values({
      dataSourceId: source.id,
      schemaName: "public",
      tableName: "users",
      context: "Existing table context",
    }).returning())[0]!;
  });

  afterAll(async () => {
    if (sourceIds.length > 0) await db.delete(dataSources).where(inArray(dataSources.id, sourceIds));
    if (owner) await db.delete(users).where(eq(users.id, owner.id));
    if (otherAdmin) await db.delete(users).where(eq(users.id, otherAdmin.id));
    if (regularUser) await db.delete(users).where(eq(users.id, regularUser.id));
    await pool.query(`DROP ROLE IF EXISTS "${readerRole}"`).catch(() => undefined);
    await pool.end();
  });

  it("enforces auth/admin and actor scope, then approves source context only", async () => {
    const proposal = await createSourceProposal({
      actorId: owner.id,
      sourceId: source.id,
      sourceName: source.name,
      currentContext: source.context,
      contextVersion: source.contextVersion,
      proposedContext: "Approved source context",
    });
    const unauthenticated = await jsonRequest("/api/admin/ai/context-proposals");
    const nonAdmin = await jsonRequest("/api/admin/ai/context-proposals", { token: regularUser.token });
    const nonAdminApproval = await jsonRequest(`/api/admin/ai/context-proposals/${proposal.id}/approve`, {
      method: "POST",
      token: regularUser.token,
    });
    const nonAdminDismissal = await jsonRequest(`/api/admin/ai/context-proposals/${proposal.id}/dismiss`, {
      method: "POST",
      token: regularUser.token,
    });
    const adminList = await jsonRequest("/api/admin/ai/context-proposals", { token: owner.token });
    expect(unauthenticated.status).toBe(401);
    expect(nonAdmin.status).toBe(403);
    expect(nonAdminApproval.status).toBe(403);
    expect(nonAdminDismissal.status).toBe(403);
    expect(adminList.status).toBe(200);

    expect((await jsonRequest(`/api/admin/ai/context-proposals/${proposal.id}`, { token: owner.token })).status).toBe(200);
    expect((await jsonRequest(`/api/admin/ai/context-proposals/${proposal.id}`, { token: otherAdmin.token })).status).toBe(404);
    expect((await jsonRequest(`/api/admin/ai/context-proposals/${proposal.id}/approve`, { method: "POST", token: otherAdmin.token })).status).toBe(404);
    expect((await jsonRequest(`/api/admin/ai/context-proposals/${proposal.id}/dismiss`, { method: "POST", token: otherAdmin.token })).status).toBe(404);

    const response = await jsonRequest(`/api/admin/ai/context-proposals/${proposal.id}/approve`, {
      method: "POST",
      token: owner.token,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: proposal.id, status: "approved" });
    const updatedSource = (await db.select().from(dataSources).where(eq(dataSources.id, source.id)))[0]!;
    expect(updatedSource.context).toBe("Approved source context");
    expect(updatedSource.contextVersion).toBe(source.contextVersion + 1);
    expect(updatedSource).toMatchObject({
      name: source.name,
      host: source.host,
      port: source.port,
      databaseName: source.databaseName,
      username: source.username,
      encryptedPassword: source.encryptedPassword,
    });
    source = updatedSource;
  });

  it("rejects stale CAS and serializes concurrent approvals to one winner", async () => {
    const staleProposal = await createTableProposal({
      actorId: owner.id,
      sourceId: source.id,
      sourceName: source.name,
      tableId: table.id,
      currentContext: table.context,
      contextVersion: table.contextVersion,
      proposedContext: "Stale context must not apply",
    });
    await db.update(dataSourceTables).set({ context: "Manually edited context", contextVersion: table.contextVersion + 1 })
      .where(eq(dataSourceTables.id, table.id));
    const staleResponse = await jsonRequest(`/api/admin/ai/context-proposals/${staleProposal.id}/approve`, {
      method: "POST",
      token: owner.token,
    });
    expect(staleResponse.status).toBe(409);
    expect((await db.select({ status: aiContextProposals.status }).from(aiContextProposals)
      .where(eq(aiContextProposals.id, staleProposal.id)))[0]?.status).toBe("stale");
    const unchangedTable = (await db.select().from(dataSourceTables).where(eq(dataSourceTables.id, table.id)))[0]!;
    expect(unchangedTable).toMatchObject({ context: "Manually edited context", contextVersion: table.contextVersion + 1 });
    table = unchangedTable;

    const concurrentProposal = await createSourceProposal({
      actorId: owner.id,
      sourceId: source.id,
      sourceName: source.name,
      currentContext: source.context,
      contextVersion: source.contextVersion,
      proposedContext: "Exactly one approval wins",
    });
    const path = `/api/admin/ai/context-proposals/${concurrentProposal.id}/approve`;
    const responses = await Promise.all([
      jsonRequest(path, { method: "POST", token: owner.token }),
      jsonRequest(path, { method: "POST", token: owner.token }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const concurrentlyUpdated = (await db.select().from(dataSources).where(eq(dataSources.id, source.id)))[0]!;
    expect(concurrentlyUpdated.context).toBe("Exactly one approval wins");
    expect(concurrentlyUpdated.contextVersion).toBe(source.contextVersion + 1);
    source = concurrentlyUpdated;
  });

  it("bumps source and retained table revisions when the endpoint changes", async () => {
    const currentHost = databaseUrl.hostname;
    if (externalDatabasePort === databasePort) throw new Error("The disposable smoke must publish a second loopback port.");
    const readerPassword = smokePassword;
    await pool.query(`CREATE ROLE "${readerRole}" LOGIN PASSWORD '${readerPassword}'`);
    const quotedDatabase = `"${databaseName.replaceAll('"', '""')}"`;
    await pool.query(`REVOKE CREATE, TEMP ON DATABASE ${quotedDatabase} FROM PUBLIC`);
    await pool.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
    await pool.query(`GRANT CONNECT ON DATABASE ${quotedDatabase} TO "${readerRole}"`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${readerRole}"`);
    await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${readerRole}"`);

    const endpointSource = (await db.insert(dataSources).values({
      name: `context-endpoint-${randomUUID()}`,
      host: currentHost,
      port: databasePort,
      databaseName,
      username: readerRole,
      encryptedPassword: encryptCredential(readerPassword, getEnvironment().CREDENTIAL_ENCRYPTION_KEY),
      context: "Endpoint source context",
      createdBy: owner.id,
    }).returning())[0]!;
    sourceIds.push(endpointSource.id);
    const retainedTable = (await db.insert(dataSourceTables).values({
      dataSourceId: endpointSource.id,
      schemaName: "public",
      tableName: "users",
      context: "Context must clear when endpoint changes",
    }).returning())[0]!;
    const sourceProposal = await createSourceProposal({
      actorId: owner.id,
      sourceId: endpointSource.id,
      sourceName: endpointSource.name,
      currentContext: endpointSource.context,
      contextVersion: endpointSource.contextVersion,
      proposedContext: "Old endpoint proposal",
    });
    const tableProposal = await createTableProposal({
      actorId: owner.id,
      sourceId: endpointSource.id,
      sourceName: endpointSource.name,
      tableId: retainedTable.id,
      currentContext: retainedTable.context,
      contextVersion: retainedTable.contextVersion,
      proposedContext: "Old table proposal",
    });

    const updateResponse = await jsonRequest(`/api/data-sources/${endpointSource.id}`, {
      method: "PATCH",
      token: owner.token,
      body: {
      name: endpointSource.name,
      host: currentHost,
      port: externalDatabasePort,
        databaseName,
        username: readerRole,
        context: endpointSource.context,
      },
    });
    expect(updateResponse.status).toBe(200);
    const updatedSource = (await db.select().from(dataSources).where(eq(dataSources.id, endpointSource.id)))[0]!;
    const updatedTable = (await db.select().from(dataSourceTables).where(eq(dataSourceTables.id, retainedTable.id)))[0]!;
    expect(updatedSource.contextVersion).toBe(endpointSource.contextVersion + 1);
    expect(updatedTable).toMatchObject({ context: "", contextVersion: retainedTable.contextVersion + 1 });
    for (const proposalId of [sourceProposal.id, tableProposal.id]) {
      const stale = await jsonRequest(`/api/admin/ai/context-proposals/${proposalId}/approve`, {
        method: "POST",
        token: owner.token,
      });
      expect(stale.status).toBe(409);
      expect((await db.select({ status: aiContextProposals.status }).from(aiContextProposals)
        .where(eq(aiContextProposals.id, proposalId)))[0]?.status).toBe("stale");
    }
  });
});
