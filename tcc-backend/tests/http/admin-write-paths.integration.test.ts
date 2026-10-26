import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { getEnvironment } from "../../src/shared/config/config.js";
import { db, pool } from "../../src/shared/db/client.js";
import {
  dashboards,
  dataSources,
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
  "PATCH de query, PUT de dashboard e não-admin (PostgreSQL descartável)",
  () => {
    let admin: SmokeUser;
    let regular: SmokeUser;
    let sourceId: string;
    let queryId: string;
    let dashboardId: string | undefined;
    const draft = () => ({
      dataSourceId: sourceId,
      sqlText: "SELECT 1 AS value",
      parameters: [],
    });
    const preview = async (extra: object = {}) =>
      (
        (await (
          await jsonRequest("/api/queries/test", {
            method: "POST",
            token: admin.token,
            body: { ...draft(), ...extra },
          })
        ).json()) as { testRunId: string }
      ).testRunId;
    const queryUpdatedAt = async () =>
      (
        await db.select().from(savedQueries).where(eq(savedQueries.id, queryId))
      )[0]!.updatedAt.toISOString();

    beforeAll(async () => {
      admin = await createUser(true, "Write paths");
      regular = await createUser(false, "Write paths");
      sourceId = (
        await db
          .insert(dataSources)
          .values({
            name: `write-paths-${randomUUID()}`,
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
      const created = await jsonRequest("/api/queries", {
        method: "POST",
        token: admin.token,
        body: { ...draft(), name: "Original", testRunId: await preview() },
      });
      queryId = ((await created.json()) as { id: string }).id;
    });

    afterAll(async () => {
      if (dashboardId) {
        await rm(resolve(process.cwd(), "dashboards", `${dashboardId}.json`), {
          force: true,
        });
        await db
          .delete(dashboards)
          .where(eq(dashboards.dashboardId, dashboardId));
      }
      await db
        .delete(savedQueries)
        .where(eq(savedQueries.dataSourceId, sourceId));
      await db.delete(dataSources).where(eq(dataSources.id, sourceId));
      await db.delete(users).where(inArray(users.id, [admin.id, regular.id]));
      await pool.end();
    });

    it("PATCH /api/queries/:id atualiza com recibo e versão corretos e recusa versão velha", async () => {
      const expectedUpdatedAt = await queryUpdatedAt();
      const testRunId = await preview({
        mode: "update",
        queryId,
        expectedUpdatedAt,
      });
      const res = await jsonRequest(`/api/queries/${queryId}`, {
        method: "PATCH",
        token: admin.token,
        body: { ...draft(), name: "Renomeada", testRunId, expectedUpdatedAt },
      });
      expect(res.status).toBe(200);
      expect(
        (
          await db
            .select()
            .from(savedQueries)
            .where(eq(savedQueries.id, queryId))
        )[0]?.name,
      ).toBe("Renomeada");

      const stale = await jsonRequest(`/api/queries/${queryId}`, {
        method: "PATCH",
        token: admin.token,
        body: {
          ...draft(),
          name: "Velha",
          testRunId: await preview({
            mode: "update",
            queryId,
            expectedUpdatedAt: await queryUpdatedAt(),
          }),
          expectedUpdatedAt,
        },
      });
      expect(stale.status).toBe(409);
    });

    it("PUT /api/admin/dashboards/:id grava com expectedRevision válido e recusa revisão velha", async () => {
      const created = await jsonRequest("/api/admin/dashboards", {
        method: "POST",
        token: admin.token,
        body: { name: "Dashboard PUT" },
      });
      expect(created.status).toBe(201);
      dashboardId = ((await created.json()) as { id: string }).id;
      const got = (await (
        await jsonRequest(`/api/admin/dashboards/${dashboardId}`, {
          token: admin.token,
        })
      ).json()) as { document: Record<string, unknown>; revision: string };

      const put = await jsonRequest(`/api/admin/dashboards/${dashboardId}`, {
        method: "PUT",
        token: admin.token,
        body: {
          document: { ...got.document, name: "Dashboard editado" },
          expectedRevision: got.revision,
        },
      });
      expect(put.status).toBe(200);
      const body = (await put.json()) as { saved: boolean; revision: string };
      expect(body.saved).toBe(true);
      expect(body.revision).not.toBe(got.revision);
      const file = JSON.parse(
        await readFile(
          resolve(process.cwd(), "dashboards", `${dashboardId}.json`),
          "utf8",
        ),
      ) as { name: string };
      expect(file.name).toBe("Dashboard editado");

      const stale = await jsonRequest(`/api/admin/dashboards/${dashboardId}`, {
        method: "PUT",
        token: admin.token,
        body: { document: got.document, expectedRevision: got.revision },
      });
      expect(stale.status).toBe(409);
    });

    it("usuário não-admin recebe 403 nas rotas administrativas e 401 sem sessão", async () => {
      const id = dashboardId ?? randomUUID();
      for (const [method, path, body] of [
        ["PATCH", `/api/queries/${queryId}`, {}],
        ["PUT", `/api/admin/dashboards/${id}`, {}],
        ["POST", "/api/admin/dashboards", { name: "x" }],
      ] as const) {
        const denied = await jsonRequest(path, {
          method,
          token: regular.token,
          body,
        });
        expect(denied.status, `${method} ${path}`).toBe(403);
        const anon = await jsonRequest(path, { method, body });
        expect(anon.status, `${method} ${path}`).toBe(401);
      }
    });
  },
);
