import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { getEnvironment } from "../../src/shared/config/config.js";
import { db, pool } from "../../src/shared/db/client.js";
import {
  aiComponentReceipts,
  dashboardProposalReceipts,
  dashboards,
  dataSources,
  savedQueries,
  users,
} from "../../src/shared/db/schema.js";
import type { AiToolProgressEvent } from "../../src/modules/ai/application/tools/ai-read-tools.js";
import { AiDashboardTools } from "../../src/modules/ai/application/tools/ai-dashboard-tools.js";
import { DrizzleAiDashboardToolsRepository } from "../../src/modules/ai/infrastructure/ai-dashboard-tools-repository.js";
import { externalSourceAdapter } from "../../src/modules/data-sources/infrastructure/external-source-adapter.js";
import type { AuthenticatedUser } from "../../src/modules/identity/domain/auth-user.js";
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
  "preview/commit de propostas de dashboard (PostgreSQL descartável e disco)",
  () => {
    const dashboardsDir = resolve(process.cwd(), "dashboards");
    let dashboardId = "";
    let dashboardFile = "";
    let admin: SmokeUser;
    let other: SmokeUser;
    let sourceId: string;
    let queryId: string;
    let receiptId: string;
    let componentReceiptId: string;
    let baseline: string;
    const events: AiToolProgressEvent[] = [];
    let proposeComponent: () => Promise<{
      proposalId: string;
      canCommit: boolean;
    }>;

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
        sqlText: "SELECT {{amount}}::int AS value, {{note}}::text AS note",
        parameters: [
          { name: "amount", label: "Valor", type: "number", required: true },
          { name: "note", label: "Nota", type: "text", required: false },
        ],
      };
      const preview = (await (
        await jsonRequest("/api/queries/test", {
          method: "POST",
          token: admin.token,
          body: { ...draft, values: { amount: "1" } },
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

      // Dashboard ativo: criado e com um filtro (workspace.params) pelas rotas de administração.
      const createdDashboard = await jsonRequest("/api/admin/dashboards", {
        method: "POST",
        token: admin.token,
        body: { name: "Dashboard de integração" },
      });
      expect(createdDashboard.status).toBe(201);
      dashboardId = ((await createdDashboard.json()) as { id: string }).id;
      dashboardFile = resolve(dashboardsDir, `${dashboardId}.json`);
      const current = (await (
        await jsonRequest(`/api/admin/dashboards/${dashboardId}`, {
          token: admin.token,
        })
      ).json()) as {
        document: { workspace: { params: unknown[] } };
        revision: string;
      };
      current.document.workspace.params = [
        { name: "valor", label: "Valor", type: "number", required: true },
      ];
      const saved = await jsonRequest(`/api/admin/dashboards/${dashboardId}`, {
        method: "PUT",
        token: admin.token,
        body: {
          document: current.document,
          expectedRevision: current.revision,
        },
      });
      expect(saved.status).toBe(200);
      baseline = await readFile(dashboardFile, "utf8");

      const tools = new AiDashboardTools({
        currentUser: { id: admin.id, isAdmin: true } as AuthenticatedUser,
        pageDashboardId: dashboardId,
        onToolEvent: (event) => {
          events.push(event);
        },
        repository: new DrizzleAiDashboardToolsRepository(
          externalSourceAdapter,
        ),
      }).tools();
      const propose = tools.find(
        (t) => t.name === "create_or_update_dashboard",
      )!;
      const component = {
        id: "total",
        component: "stat_card",
        title: "Total",
        queryUuid: queryId,
        field: "value",
      };
      const previewComponent = tools.find(
        (t) => t.name === "preview_component",
      )!;
      const componentPreview = (await previewComponent.invoke({
        component,
        parameterBindings: { amount: "valor" },
        previewValues: { amount: "1" },
      })) as { componentReceiptId: string };
      componentReceiptId = componentPreview.componentReceiptId;
      proposeComponent = async () =>
        (await propose.invoke({
          mode: "update",
          dashboardId,
          name: "Dashboard de integração",
          components: [component],
          componentReceiptId,
          position: { placement: "end" },
        })) as { proposalId: string; canCommit: boolean };
    });

    afterAll(async () => {
      if (dashboardFile) await rm(dashboardFile, { force: true });
      if (dashboardId)
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

    const componentRoute = (suffix: "preview" | "approve") =>
      `/api/admin/ai/component-receipts/${componentReceiptId}/${suffix}`;

    it("prévia do componente por valores repete a query sem a IA e respeita dono e filtros", async () => {
      const ok = await jsonRequest(componentRoute("preview"), {
        method: "POST",
        token: admin.token,
        body: {
          contextValues: { valor: "7" },
          parameterValues: { note: "x" },
        },
      });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({
        query: { rows: [{ value: "7", note: "x" }] },
      });

      const invalid = await jsonRequest(componentRoute("preview"), {
        method: "POST",
        token: admin.token,
        body: { contextValues: { valor: "abc" } },
      });
      expect(invalid.status).toBe(200);
      expect(
        ((await invalid.json()) as { query: { error?: string } }).query.error,
      ).toBeTruthy();

      const unknown = await jsonRequest(componentRoute("preview"), {
        method: "POST",
        token: admin.token,
        body: { contextValues: { fantasma: "1" } },
      });
      expect(unknown.status).toBe(400);

      const stranger = await jsonRequest(componentRoute("preview"), {
        method: "POST",
        token: other.token,
        body: { contextValues: { valor: "7" } },
      });
      expect(stranger.status).toBe(409);
    });

    it("aprovar guarda valores e ligações no Recibo de componente", async () => {
      const res = await jsonRequest(componentRoute("approve"), {
        method: "POST",
        token: admin.token,
        body: {
          contextValues: { valor: "7" },
          parameterValues: { note: "x" },
        },
      });
      expect(res.status).toBe(200);
      const [row] = await db
        .select()
        .from(aiComponentReceipts)
        .where(eq(aiComponentReceipts.id, componentReceiptId));
      expect(row).toMatchObject({
        dashboardId,
        parameterBindings: { amount: "valor" },
        contextValues: { valor: "7" },
        parameterValues: { note: "x" },
      });
      expect(row?.approvedAt).not.toBeNull();
    });

    it("a proposta abre a prévia final com os mesmos valores e resultado", async () => {
      const proposal = await proposeComponent();
      expect(proposal.canCommit).toBe(true);
      receiptId = proposal.proposalId;
      const preview = events.find(
        (event) =>
          event.type === "dashboard_preview" &&
          event.proposalId === proposal.proposalId,
      );
      if (preview?.type !== "dashboard_preview") throw new Error("sem prévia");
      expect(preview.contextValues).toEqual({ valor: "7" });
      expect(preview.document.queryBindings).toEqual([
        {
          queryUuid: queryId,
          parameters: {
            amount: { source: "context", argument: "valor" },
            note: { source: "manual", value: "x" },
          },
        },
      ]);
      expect(preview.queries[queryId]?.rows).toEqual([
        { value: "7", note: "x" },
      ]);
    });

    it("prévia roda a query salva com os mesmos valores sem gravar nada em disco", async () => {
      const res = await jsonRequest(
        `/api/admin/ai/dashboard-proposals/${receiptId}/preview`,
        {
          method: "POST",
          token: admin.token,
          body: { componentIds: ["total"], contextValues: { valor: "7" } },
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        queries: Record<string, { rows: unknown[] }>;
        issues: string[];
      };
      expect(body.issues).toEqual([]);
      expect(body.queries[queryId]?.rows).toEqual([{ value: "7", note: "x" }]);
      expect(await readFile(dashboardFile, "utf8")).toBe(baseline);
    });

    it("commit de outra sessão é recusado e nada é gravado", async () => {
      const res = await jsonRequest(
        `/api/admin/ai/dashboard-proposals/${receiptId}/commit`,
        { method: "POST", token: other.token, body: {} },
      );
      expect(res.status).toBe(409);
      expect(await readFile(dashboardFile, "utf8")).toBe(baseline);
    });

    it("commit grava o arquivo, consome o recibo e é idempotente", async () => {
      const res = await jsonRequest(
        `/api/admin/ai/dashboard-proposals/${receiptId}/commit`,
        { method: "POST", token: admin.token, body: {} },
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        id: dashboardId,
        mode: "update",
        alreadyApplied: false,
      });
      const written = JSON.parse(await readFile(dashboardFile, "utf8")) as {
        id: string;
        queryBindings: { queryUuid: string }[];
      };
      expect(written.id).toBe(dashboardId);
      expect(written.queryBindings.map((b) => b.queryUuid)).toEqual([queryId]);
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
