import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, rmdir } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { getEnvironment } from "../../src/shared/config/config.js";
import { db, pool } from "../../src/shared/db/client.js";
import {
  dashboardProposalReceipts,
  dashboards,
  dataSources,
  savedQueries,
  users,
} from "../../src/shared/db/schema.js";
import { encryptCredential } from "../../src/shared/lib/credentials.js";
import { dashboardDocumentSchema } from "../../src/shared/lib/contracts.js";
import { querySourceTargetHash } from "../../src/modules/queries/domain/query-lifecycle.js";
import {
  dashboardDocumentFingerprint,
  dashboardReferenceFingerprint,
} from "../../src/modules/dashboards/domain/dashboard-proposals.js";
import {
  createUser,
  databaseName,
  databasePort,
  databaseUrl,
  integrationDescribe,
  jsonRequest,
  type SmokeUser,
} from "./helpers/postgres-integration.js";

integrationDescribe(
  "preview/commit de propostas de dashboard (PostgreSQL descartável e disco)",
  () => {
    const dashboardsDir = resolve(process.cwd(), "dashboards");
    const dashboardId = randomUUID();
    const dashboardFile = resolve(dashboardsDir, `${dashboardId}.json`);
    let createdDir = false;
    let admin: SmokeUser;
    let other: SmokeUser;
    let sourceId: string;
    let queryId: string;
    let receiptId: string;
    let document: Record<string, unknown>;

    beforeAll(async () => {
      admin = await createUser(true, "Dashboard proposal");
      other = await createUser(true, "Dashboard proposal other");
      const source = (
        await db
          .insert(dataSources)
          .values({
            name: `dashboard-proposal-${randomUUID()}`,
            host: databaseUrl.hostname,
            port: databasePort,
            databaseName,
            username: decodeURIComponent(databaseUrl.username),
            encryptedPassword: encryptCredential(
              decodeURIComponent(databaseUrl.password),
              getEnvironment().CREDENTIAL_ENCRYPTION_KEY,
            ),
            createdBy: admin.id,
          })
          .returning()
      )[0]!;
      sourceId = source.id;
      const draft = {
        dataSourceId: sourceId,
        sqlText: "SELECT 1 AS value",
        parameters: [],
      };
      const preview = (await (
        await jsonRequest("/api/queries/test", {
          method: "POST",
          token: admin.token,
          body: draft,
        })
      ).json()) as { testRunId: string };
      const created = await jsonRequest("/api/queries", {
        method: "POST",
        token: admin.token,
        body: {
          ...draft,
          name: "Query do dashboard",
          testRunId: preview.testRunId,
        },
      });
      expect(created.status).toBe(201);
      queryId = ((await created.json()) as { id: string }).id;
      const query = (
        await db.select().from(savedQueries).where(eq(savedQueries.id, queryId))
      )[0]!;

      document = {
        id: dashboardId,
        name: "Dashboard de integração",
        workspace: { params: [] },
        queryBindings: [{ queryUuid: queryId, parameters: {} }],
        ui: {
          layout: { gap: 16 },
          components: [
            {
              id: "total",
              component: "stat_card",
              props: { queryUuid: queryId, title: "Total", field: "value" },
            },
          ],
        },
      };
      receiptId = randomUUID();
      await db.insert(dashboardProposalReceipts).values({
        id: receiptId,
        actorId: admin.id,
        mode: "create",
        dashboardId,
        expectedDashboardFingerprint: null,
        document,
        documentFingerprint: dashboardDocumentFingerprint(
          dashboardDocumentSchema.parse(document),
        ),
        referenceFingerprint: dashboardReferenceFingerprint([
          {
            queryId,
            queryUpdatedAt: query.updatedAt,
            dataSourceId: sourceId,
            sourceUpdatedAt: source.updatedAt,
            sourceTargetHash: querySourceTargetHash(source),
          },
        ]),
        expiresAt: new Date(Date.now() + 5 * 60_000),
      });
      createdDir =
        (await access(dashboardsDir).then(
          () => false,
          () => true,
        )) && (await mkdir(dashboardsDir, { recursive: true })) !== undefined;
    });

    afterAll(async () => {
      await rm(dashboardFile, { force: true });
      if (createdDir) await rmdir(dashboardsDir).catch(() => undefined);
      await db
        .delete(dashboards)
        .where(eq(dashboards.dashboardId, dashboardId));
      await db
        .delete(savedQueries)
        .where(eq(savedQueries.dataSourceId, sourceId));
      await db.delete(dataSources).where(eq(dataSources.id, sourceId));
      await db.delete(users).where(inArray(users.id, [admin.id, other.id]));
      await pool.end();
    });

    it("prévia roda a query salva sem gravar nada em disco", async () => {
      const res = await jsonRequest(
        `/api/admin/ai/dashboard-proposals/${receiptId}/preview`,
        {
          method: "POST",
          token: admin.token,
          body: { componentIds: ["total"] },
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        queries: Record<string, { rows: unknown[] }>;
        issues: string[];
      };
      expect(body.issues).toEqual([]);
      expect(body.queries[queryId]?.rows).toEqual([{ value: "1" }]);
      await expect(access(dashboardFile)).rejects.toThrow();
    });

    it("commit de outra sessão é recusado e nada é gravado", async () => {
      const res = await jsonRequest(
        `/api/admin/ai/dashboard-proposals/${receiptId}/commit`,
        { method: "POST", token: other.token, body: {} },
      );
      expect(res.status).toBe(409);
      await expect(access(dashboardFile)).rejects.toThrow();
    });

    it("commit grava o arquivo, registra o dashboard, consome o recibo e é idempotente", async () => {
      const res = await jsonRequest(
        `/api/admin/ai/dashboard-proposals/${receiptId}/commit`,
        { method: "POST", token: admin.token, body: {} },
      );
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({
        id: dashboardId,
        mode: "create",
        alreadyApplied: false,
      });
      const written = JSON.parse(await readFile(dashboardFile, "utf8")) as {
        id: string;
      };
      expect(written.id).toBe(dashboardId);
      expect(
        (
          await db
            .select()
            .from(dashboards)
            .where(eq(dashboards.dashboardId, dashboardId))
        )[0]?.filePath,
      ).toBe(`dashboards/${dashboardId}.json`);
      expect(
        (
          await db
            .select()
            .from(dashboardProposalReceipts)
            .where(eq(dashboardProposalReceipts.id, receiptId))
        )[0]?.consumedAt,
      ).not.toBeNull();

      const again = await jsonRequest(
        `/api/admin/ai/dashboard-proposals/${receiptId}/commit`,
        { method: "POST", token: admin.token, body: {} },
      );
      expect(again.status).toBe(200);
      expect(await again.json()).toMatchObject({ alreadyApplied: true });
    });
  },
);
