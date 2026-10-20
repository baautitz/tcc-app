import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { getEnvironment } from "../../src/shared/config/config.js";
import { db, pool } from "../../src/shared/db/client.js";
import {
  dataSources,
  queryTestRuns,
  savedQueries,
  users,
} from "../../src/shared/db/schema.js";
import { encryptCredential } from "../../src/shared/lib/credentials.js";
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
  "POST /api/queries/test com recibo e persistência (PostgreSQL descartável)",
  () => {
    let admin: SmokeUser;
    let regular: SmokeUser;
    let sourceId: string;
    const draft = () => ({
      dataSourceId: sourceId,
      sqlText: "SELECT 1 AS value",
      parameters: [],
    });

    beforeAll(async () => {
      admin = await createUser(true, "Query receipt");
      regular = await createUser(false, "Query receipt");
      sourceId = (
        await db
          .insert(dataSources)
          .values({
            name: `query-receipt-${randomUUID()}`,
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
          .returning({ id: dataSources.id })
      )[0]!.id;
    });

    afterAll(async () => {
      await db
        .delete(savedQueries)
        .where(eq(savedQueries.dataSourceId, sourceId));
      await db.delete(dataSources).where(eq(dataSources.id, sourceId));
      await db.delete(users).where(inArray(users.id, [admin.id, regular.id]));
      await pool.end();
    });

    it("emite recibo no teste, grava a query com ele e o recibo só vale uma vez", async () => {
      const denied = await jsonRequest("/api/queries/test", {
        method: "POST",
        token: regular.token,
        body: draft(),
      });
      expect(denied.status).toBe(403);

      const preview = await jsonRequest("/api/queries/test", {
        method: "POST",
        token: admin.token,
        body: draft(),
      });
      expect(preview.status).toBe(200);
      const body = (await preview.json()) as {
        testRunId: string;
        rows: unknown[];
        rowCount: number;
      };
      expect(body.rowCount).toBe(1);
      expect(body.rows).toEqual([{ value: "1" }]);
      expect(
        (
          await db
            .select()
            .from(queryTestRuns)
            .where(eq(queryTestRuns.id, body.testRunId))
        )[0],
      ).toMatchObject({ actorId: admin.id, consumedAt: null });

      const createBody = {
        ...draft(),
        name: "Query com recibo",
        testRunId: body.testRunId,
      };
      const created = await jsonRequest("/api/queries", {
        method: "POST",
        token: admin.token,
        body: createBody,
      });
      expect(created.status).toBe(201);
      const query = (await created.json()) as { id: string };
      expect(
        (
          await db
            .select()
            .from(savedQueries)
            .where(eq(savedQueries.id, query.id))
        )[0],
      ).toMatchObject({ name: "Query com recibo", dataSourceId: sourceId });
      expect(
        (
          await db
            .select()
            .from(queryTestRuns)
            .where(eq(queryTestRuns.id, body.testRunId))
        )[0]?.consumedAt,
      ).not.toBeNull();

      const reused = await jsonRequest("/api/queries", {
        method: "POST",
        token: admin.token,
        body: { ...createBody, name: "Segunda via" },
      });
      expect(reused.status).toBe(409);
      expect(
        await db
          .select({ id: savedQueries.id })
          .from(savedQueries)
          .where(eq(savedQueries.dataSourceId, sourceId)),
      ).toHaveLength(1);
    });

    it("recibo não vale para rascunho diferente do testado", async () => {
      const preview = (await (
        await jsonRequest("/api/queries/test", {
          method: "POST",
          token: admin.token,
          body: draft(),
        })
      ).json()) as { testRunId: string };
      const res = await jsonRequest("/api/queries", {
        method: "POST",
        token: admin.token,
        body: {
          ...draft(),
          sqlText: "SELECT 2 AS value",
          name: "Rascunho alterado",
          testRunId: preview.testRunId,
        },
      });
      expect(res.status).toBe(409);
    });
  },
);
