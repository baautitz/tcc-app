import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://u:p@localhost:5432/x";
  process.env.CREDENTIAL_ENCRYPTION_KEY = "a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s=";
  const state = {
    queue: [] as unknown[],
    user: null as null | { id: string; name: string; email: string; isAdmin: boolean; permissions: string[] },
    // fake in-memory do QueryLifecycleRepository (a lógica real de recibo roda por cima)
    lifecycle: { source: undefined as any, query: undefined as any, receipts: new Map<string, any>(), inserted: [] as any[], updated: [] as any[] },
    dashboardFiles: [] as any[],
  };
  const chain = (): unknown => {
    const p: unknown = new Proxy(function () {}, {
      get: (_t, key) => {
        if (key === "then") {
          const next = state.queue.shift();
          return (res: (v: unknown) => void, rej: (e: unknown) => void) => {
            if (next instanceof Error) rej(next); else res(next ?? []);
          };
        }
        return () => p;
      },
    });
    return p;
  };
  const fakeDb: Record<string, unknown> = new Proxy({}, {
    get: (_t, key) => key === "transaction"
      ? async (fn: (tx: unknown) => unknown) => fn(fakeDb)
      : () => chain(),
  });
  return { state, fakeDb };
});

vi.mock("../../src/shared/db/client.js", () => ({ db: h.fakeDb, pool: {} }));
vi.mock("../../src/modules/identity/application/auth.js", async (orig) => ({
  ...(await orig<typeof import("../../src/modules/identity/application/auth.js")>()),
  findAuthenticatedUser: vi.fn(async (token?: string) => (token ? h.state.user : null)),
}));
vi.mock("../../src/modules/data-sources/infrastructure/external-pg/index.js", async (orig) => ({
  ...(await orig<typeof import("../../src/modules/data-sources/infrastructure/external-pg/index.js")>()),
  runReadOnlyQuery: vi.fn(async () => [{ n: 1 }]),
  runBoundedReadOnlyQueryWithRetry: vi.fn(async () => ({ rows: [{ n: 1 }], truncated: false })),
  inspectReadOnlyPostgres: vi.fn(async () => [{ schemaName: "public", tableName: "t" }]),
}));
vi.mock("../../src/modules/queries/infrastructure/query-lifecycle-repository.js", () => ({
  createQueryLifecycleRepository: () => ({
    transaction: async (op: (tx: unknown) => unknown) => op({
      lockSource: async (id: string) => (h.state.lifecycle.source?.id === id ? h.state.lifecycle.source : undefined),
      lockQuery: async (id: string) => (h.state.lifecycle.query?.id === id ? h.state.lifecycle.query : undefined),
      insertReceipt: async (r: any) => {
        const receipt = { ...r, id: RECEIPT, consumedAt: null };
        h.state.lifecycle.receipts.set(RECEIPT, receipt);
        return receipt;
      },
      consumeReceipt: async (id: string, actorId: string) => {
        const r = h.state.lifecycle.receipts.get(id);
        if (!r || r.consumedAt || r.actorId !== actorId) return undefined;
        r.consumedAt = new Date();
        return r;
      },
      insertQuery: async (q: any) => {
        const row = { ...q, id: NEWQ, createdAt: new Date(), updatedAt: new Date() };
        h.state.lifecycle.inserted.push(row);
        return row;
      },
      updateQuery: async (id: string, u: any) => {
        const row = { ...h.state.lifecycle.query, ...u };
        h.state.lifecycle.updated.push(row);
        return row;
      },
    }),
  }),
}));
vi.mock("../../src/modules/dashboards/domain/dashboards.js", async (orig) => ({
  ...(await orig<typeof import("../../src/modules/dashboards/domain/dashboards.js")>()),
  getDashboardFiles: vi.fn(async () => h.state.dashboardFiles),
  withDashboardFileCompensation: vi.fn(async (op: () => unknown) => op()),
  writeDashboardDocumentAtomically: vi.fn(async () => async () => {}),
}));
vi.mock("../../src/modules/dashboards/application/dashboard-admin.js", async (orig) => ({
  ...(await orig<typeof import("../../src/modules/dashboards/application/dashboard-admin.js")>()),
  saveDashboardDocument: vi.fn(async () => {}),
}));
vi.mock("../../src/modules/dashboards/application/dashboard-proposal-commit.js", () => ({
  previewDashboardProposal: vi.fn(),
  commitDashboardProposal: vi.fn(),
}));
vi.mock("../../src/modules/data-sources/domain/data-source-catalog.js", async (orig) => ({
  ...(await orig<typeof import("../../src/modules/data-sources/domain/data-source-catalog.js")>()),
  reconcileDataSourceCatalog: vi.fn(async () => {}),
}));

const RECEIPT = "33333333-3333-4333-8333-333333333333";
const NEWQ = "44444444-4444-4444-8444-444444444444";

import { app } from "../../src/app.js";
import { dashboardDocumentSchema } from "../../src/shared/lib/contracts.js";
import { encryptCredential } from "../../src/shared/lib/credentials.js";
import { dashboardDocumentFingerprint } from "../../src/modules/dashboards/domain/dashboard-proposals.js";
import { runBoundedReadOnlyQueryWithRetry, inspectReadOnlyPostgres } from "../../src/modules/data-sources/infrastructure/external-pg/index.js";
import { saveDashboardDocument } from "../../src/modules/dashboards/application/dashboard-admin.js";
import { writeDashboardDocumentAtomically } from "../../src/modules/dashboards/domain/dashboards.js";
import { commitDashboardProposal, previewDashboardProposal } from "../../src/modules/dashboards/application/dashboard-proposal-commit.js";
import { reconcileDataSourceCatalog } from "../../src/modules/data-sources/domain/data-source-catalog.js";

const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";
const admin = { id: UUID, name: "Admin", email: "a@x.com", isAdmin: true, permissions: [] };
const plain = { id: UUID2, name: "Bob", email: "b@x.com", isAdmin: false, permissions: [] };
const COOKIE = { Cookie: "tcc_session=abc" };

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = COOKIE) =>
  app.request(path, {
    method,
    headers: { ...headers, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

// Linhas fixas (drizzle $inferSelect de dataSources / savedQueries em db/schema.ts)
const SRC_AT = new Date("2025-01-01T00:00:00.000Z");
const QRY_AT = new Date("2025-01-02T00:00:00.000Z");
const sourceRow = {
  id: UUID, name: "S", host: "h", port: 5432, databaseName: "d", username: "u",
  encryptedPassword: encryptCredential("pw", "a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s="),
  context: "", contextVersion: 1, createdBy: UUID, createdAt: SRC_AT, updatedAt: SRC_AT,
};
const queryRow = {
  id: UUID2, dataSourceId: UUID, name: "Q", sqlText: "select 1 as n", parameters: [],
  createdBy: UUID, createdAt: QRY_AT, updatedAt: QRY_AT,
};
const draft = { dataSourceId: UUID, sqlText: "select 1 as n", parameters: [], values: {} };

beforeEach(() => {
  vi.clearAllMocks();
  h.state.queue = [];
  h.state.user = admin;
  h.state.dashboardFiles = [];
  h.state.lifecycle = { source: sourceRow, query: queryRow, receipts: new Map(), inserted: [], updated: [] };
});

describe("queries com recibo", () => {
  it("POST /test (create) emite recibo e devolve prévia", async () => {
    h.state.queue = [[sourceRow], [sourceRow]]; // source inicial + recheck
    const res = await call("POST", "/api/queries/test", { ...draft, mode: "create" });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body).toMatchObject({
      testRunId: RECEIPT, rowCount: 1, rows: [{ n: 1 }], sqlText: "select 1 as n",
      dataSource: { id: UUID, name: "S" }, intent: { mode: "create", queryName: "Nova query" },
    });
    expect(runBoundedReadOnlyQueryWithRetry).toHaveBeenCalledOnce();
    expect(h.state.lifecycle.receipts.has(RECEIPT)).toBe(true);
  });
  it("POST /test (update) com versão atual -> intent com queryId", async () => {
    h.state.queue = [[sourceRow], [queryRow], [sourceRow], [queryRow]];
    const res = await call("POST", "/api/queries/test", { ...draft, mode: "update", queryId: UUID2, expectedUpdatedAt: QRY_AT.toISOString() });
    expect(res.status).toBe(200);
    expect((await res.json() as any).intent).toEqual({ mode: "update", queryName: "Q", queryId: UUID2, queryUpdatedAt: QRY_AT.toISOString() });
  });
  it("POST /test (update) versão divergente -> 409", async () => {
    h.state.queue = [[sourceRow], [queryRow]];
    const res = await call("POST", "/api/queries/test", { ...draft, mode: "update", queryId: UUID2, expectedUpdatedAt: "2030-01-01T00:00:00.000Z" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "A query foi alterada desde que foi aberta. Recarregue-a e teste novamente." });
  });
  it("POST /test (update) query inexistente -> 404", async () => {
    h.state.queue = [[sourceRow], []];
    const res = await call("POST", "/api/queries/test", { ...draft, mode: "update", queryId: UUID2, expectedUpdatedAt: QRY_AT.toISOString() });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "A query para edição não existe neste servidor." });
  });
  it("POST /test: servidor alterado durante o teste -> 409", async () => {
    h.state.queue = [[sourceRow], [{ ...sourceRow, updatedAt: new Date("2026-01-01T00:00:00.000Z") }]];
    const res = await call("POST", "/api/queries/test", { ...draft, mode: "create" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "O servidor foi alterado durante o teste. Gere uma nova prévia." });
  });
  it("POST /test: erro de execução -> 400 com a mensagem", async () => {
    vi.mocked(runBoundedReadOnlyQueryWithRetry).mockRejectedValueOnce(new Error("boom"));
    h.state.queue = [[sourceRow]];
    const res = await call("POST", "/api/queries/test", { ...draft, mode: "create" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "boom" });
  });
  it("POST /test: SQL não somente-leitura -> 400", async () => {
    expect((await call("POST", "/api/queries/test", { ...draft, sqlText: "delete from t" })).status).toBe(400);
  });
  it("POST /test: só queries:create não pode testar modo update -> 403", async () => {
    h.state.user = { ...plain, permissions: ["queries:create"] };
    const res = await call("POST", "/api/queries/test", { ...draft, mode: "update", queryId: UUID2, expectedUpdatedAt: QRY_AT.toISOString() });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "A permissão 'queries:update' é necessária para pré-visualizar esta ação." });
  });

  it("fluxo create: teste -> POST /api/queries consome recibo -> 201", async () => {
    h.state.queue = [[sourceRow], [sourceRow]];
    await call("POST", "/api/queries/test", { ...draft, mode: "create" });
    const res = await call("POST", "/api/queries", { dataSourceId: UUID, name: "Nova", sqlText: draft.sqlText, parameters: [], testRunId: RECEIPT });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: NEWQ, name: "Nova", dataSourceId: UUID, createdBy: UUID });
    // recibo é de uso único
    const again = await call("POST", "/api/queries", { dataSourceId: UUID, name: "Nova", sqlText: draft.sqlText, parameters: [], testRunId: RECEIPT });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "A prévia expirou, já foi usada ou não corresponde ao rascunho. Teste novamente antes de salvar." });
  });
  it("POST /api/queries com recibo inexistente -> 409", async () => {
    const res = await call("POST", "/api/queries", { dataSourceId: UUID, name: "Nova", sqlText: draft.sqlText, parameters: [], testRunId: RECEIPT });
    expect(res.status).toBe(409);
  });
  it("POST /api/queries com rascunho diferente do recibo -> 409", async () => {
    h.state.queue = [[sourceRow], [sourceRow]];
    await call("POST", "/api/queries/test", { ...draft, mode: "create" });
    const res = await call("POST", "/api/queries", { dataSourceId: UUID, name: "Nova", sqlText: "select 2 as n", parameters: [], testRunId: RECEIPT });
    expect(res.status).toBe(409);
  });
  it("POST /api/queries com servidor inexistente -> 404", async () => {
    h.state.lifecycle.source = undefined;
    const res = await call("POST", "/api/queries", { dataSourceId: UUID, name: "Nova", sqlText: draft.sqlText, parameters: [], testRunId: RECEIPT });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Servidor PostgreSQL não encontrado." });
  });
  it("POST /api/queries com SQL inválida -> 400", async () => {
    const res = await call("POST", "/api/queries", { dataSourceId: UUID, name: "Nova", sqlText: "drop table x", parameters: [], testRunId: RECEIPT });
    expect(res.status).toBe(400);
  });

  it("fluxo update: teste -> PATCH /api/queries/:id -> 200", async () => {
    h.state.queue = [[sourceRow], [queryRow], [sourceRow], [queryRow]];
    const t = await call("POST", "/api/queries/test", { ...draft, sqlText: "select 2 as n", mode: "update", queryId: UUID2, expectedUpdatedAt: QRY_AT.toISOString() });
    expect(t.status).toBe(200);
    const res = await call("PATCH", `/api/queries/${UUID2}`, {
      dataSourceId: UUID, name: "Q2", sqlText: "select 2 as n", parameters: [], testRunId: RECEIPT, expectedUpdatedAt: QRY_AT.toISOString(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: UUID2, name: "Q2", sqlText: "select 2 as n" });
    expect(h.state.lifecycle.updated).toHaveLength(1);
  });
  it("PATCH com versão desatualizada -> 400 (recibo não corresponde)", async () => {
    h.state.queue = [[sourceRow], [queryRow], [sourceRow], [queryRow]];
    await call("POST", "/api/queries/test", { ...draft, mode: "update", queryId: UUID2, expectedUpdatedAt: QRY_AT.toISOString() });
    const res = await call("PATCH", `/api/queries/${UUID2}`, {
      dataSourceId: UUID, name: "Q", sqlText: draft.sqlText, parameters: [], testRunId: RECEIPT, expectedUpdatedAt: "2030-01-01T00:00:00.000Z",
    });
    expect(res.status).toBe(400);
  });
  it("PATCH sem permissão -> 403, corpo inválido -> 400", async () => {
    expect((await call("PATCH", `/api/queries/${UUID2}`, { name: "x" })).status).toBe(400);
    h.state.user = plain;
    expect((await call("PATCH", `/api/queries/${UUID2}`, {})).status).toBe(403);
  });
});

describe("DELETE /api/queries/:id", () => {
  // fila: execute(advisory lock), select ... for update, delete ... returning
  it("sucesso -> 204", async () => {
    h.state.queue = [[], [{ id: UUID2, name: "Q" }], [{ id: UUID2 }]];
    const res = await call("DELETE", `/api/queries/${UUID2}`);
    expect(res.status).toBe(204);
    expect(writeDashboardDocumentAtomically).not.toHaveBeenCalled();
  });
  it("remove componentes/bindings do dashboard que usam a query", async () => {
    h.state.dashboardFiles = [{
      filePath: "/x/d.json",
      dashboard: {
        id: UUID, name: "D", workspace: { params: [] },
        queryBindings: [{ queryUuid: UUID2, parameters: {} }],
        ui: { layout: { gap: 16 }, components: [{ id: "c", component: "data_table", props: { queryUuid: UUID2 } }] },
      },
    }];
    h.state.queue = [[], [{ id: UUID2, name: "Q" }], [{ id: UUID2 }]];
    expect((await call("DELETE", `/api/queries/${UUID2}`)).status).toBe(204);
    expect(writeDashboardDocumentAtomically).toHaveBeenCalledOnce();
    const written = vi.mocked(writeDashboardDocumentAtomically).mock.calls[0]![1] as any;
    expect(written.queryBindings).toEqual([]);
    expect(written.ui.components).toEqual([]);
  });
  it("lookup de filtro referencia a query -> 400", async () => {
    h.state.dashboardFiles = [{
      filePath: "/x/d.json",
      dashboard: { id: UUID, name: "D", workspace: { params: [{ label: "Filtro", lookup: { queryUuid: UUID2 } }] }, queryBindings: [], ui: { components: [] } },
    }];
    h.state.queue = [[], [{ id: UUID2, name: "Q" }]];
    const res = await call("DELETE", `/api/queries/${UUID2}`);
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toMatch(/fornece as opções do filtro 'Filtro' no dashboard 'D'/);
    expect(writeDashboardDocumentAtomically).not.toHaveBeenCalled();
  });
  it("sem permissão -> 403", async () => {
    h.state.user = plain;
    expect((await call("DELETE", `/api/queries/${UUID2}`)).status).toBe(403);
  });
});

describe("PUT /api/admin/dashboards/:id", () => {
  const document = { id: UUID, name: "D" };
  const revision = "a".repeat(64);
  it("salva e devolve a nova revisão", async () => {
    const res = await call("PUT", `/api/admin/dashboards/${UUID}`, { document, expectedRevision: revision });
    expect(res.status).toBe(200);
    const parsed = dashboardDocumentSchema.parse(document);
    expect(await res.json()).toEqual({ id: UUID, saved: true, revision: dashboardDocumentFingerprint(parsed) });
    expect(saveDashboardDocument).toHaveBeenCalledWith(UUID, { document: parsed, expectedRevision: revision });
  });
  it("id do documento diferente -> 400", async () => {
    const res = await call("PUT", `/api/admin/dashboards/${UUID}`, { document: { ...document, id: UUID2 }, expectedRevision: revision });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "O id do dashboard não pode ser alterado." });
    expect(saveDashboardDocument).not.toHaveBeenCalled();
  });
  it("revisão malformada -> 400; id não-uuid -> 400", async () => {
    expect((await call("PUT", `/api/admin/dashboards/${UUID}`, { document, expectedRevision: "x" })).status).toBe(400);
    expect((await call("PUT", `/api/admin/dashboards/xyz`, { document, expectedRevision: revision })).status).toBe(400);
  });
  it("não-admin -> 403", async () => {
    h.state.user = plain;
    expect((await call("PUT", `/api/admin/dashboards/${UUID}`, { document, expectedRevision: revision })).status).toBe(403);
  });
});

describe("dashboard-proposals preview/commit", () => {
  it("preview repassa usuário, receipt e corpo; devolve o resultado do serviço", async () => {
    vi.mocked(previewDashboardProposal).mockResolvedValueOnce({ ok: true } as never);
    const res = await call("POST", `/api/admin/ai/dashboard-proposals/${UUID}/preview`, { componentIds: ["c1"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(previewDashboardProposal).toHaveBeenCalledWith(admin, UUID, { contextValues: {}, componentIds: ["c1"] });
  });
  it("preview inválido (sem componentIds / campo extra / id ruim) -> 400; não-admin -> 403", async () => {
    expect((await call("POST", `/api/admin/ai/dashboard-proposals/${UUID}/preview`, {})).status).toBe(400);
    expect((await call("POST", `/api/admin/ai/dashboard-proposals/${UUID}/preview`, { componentIds: [], x: 1 })).status).toBe(400);
    expect((await call("POST", `/api/admin/ai/dashboard-proposals/xyz/preview`, { componentIds: [] })).status).toBe(400);
    h.state.user = plain;
    expect((await call("POST", `/api/admin/ai/dashboard-proposals/${UUID}/preview`, { componentIds: [] })).status).toBe(403);
  });
  it("commit create novo -> 201", async () => {
    vi.mocked(commitDashboardProposal).mockResolvedValueOnce({ mode: "create", alreadyApplied: false, id: UUID } as never);
    const res = await call("POST", `/api/admin/ai/dashboard-proposals/${UUID}/commit`, {});
    expect(res.status).toBe(201);
    expect(commitDashboardProposal).toHaveBeenCalledWith(admin, UUID, { acknowledgeTruncation: false });
  });
  it("commit create já aplicado e update -> 200", async () => {
    vi.mocked(commitDashboardProposal)
      .mockResolvedValueOnce({ mode: "create", alreadyApplied: true } as never)
      .mockResolvedValueOnce({ mode: "update", alreadyApplied: false } as never);
    expect((await call("POST", `/api/admin/ai/dashboard-proposals/${UUID}/commit`, { acknowledgeTruncation: true })).status).toBe(200);
    expect((await call("POST", `/api/admin/ai/dashboard-proposals/${UUID}/commit`, {})).status).toBe(200);
  });
  it("commit com corpo inválido -> 400", async () => {
    expect((await call("POST", `/api/admin/ai/dashboard-proposals/${UUID}/commit`, { acknowledgeTruncation: "sim" })).status).toBe(400);
  });
});

describe("data-sources POST/refresh/PATCH", () => {
  const input = { name: "Srv", host: "h", port: 5432, databaseName: "d", username: "u", password: "pw" };
  it("POST cria, cataloga e não vaza senha -> 201", async () => {
    h.state.queue = [[sourceRow]]; // insert ... returning
    const res = await call("POST", "/api/data-sources", input);
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ id: UUID, name: "S", tables: [{ schemaName: "public", tableName: "t" }] });
    expect(body).not.toHaveProperty("encryptedPassword");
    expect(inspectReadOnlyPostgres).toHaveBeenCalledWith({ host: "h", port: 5432, database: "d", user: "u", password: "pw" });
    expect(reconcileDataSourceCatalog).toHaveBeenCalledOnce();
  });
  it("POST: insert sem retorno -> 500", async () => {
    h.state.queue = [[]];
    const res = await call("POST", "/api/data-sources", input);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Não foi possível salvar o servidor PostgreSQL." });
  });
  it("POST: falha na inspeção propaga erro e não insere", async () => {
    vi.mocked(inspectReadOnlyPostgres).mockRejectedValueOnce(new Error("conn refused"));
    const res = await call("POST", "/api/data-sources", input);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(reconcileDataSourceCatalog).not.toHaveBeenCalled();
  });
  it("refresh -> 200 com tabelas", async () => {
    h.state.queue = [[sourceRow]];
    const res = await call("POST", `/api/data-sources/${UUID}/refresh`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tables: [{ schemaName: "public", tableName: "t" }] });
    expect(reconcileDataSourceCatalog).toHaveBeenCalledOnce();
  });
  it("refresh: 404 se servidor não existe; 403 sem permissão", async () => {
    expect((await call("POST", `/api/data-sources/${UUID}/refresh`)).status).toBe(404);
    h.state.user = plain;
    expect((await call("POST", `/api/data-sources/${UUID}/refresh`)).status).toBe(403);
  });
  it("PATCH sem senha reaproveita a atual e devolve fonte segura", async () => {
    h.state.queue = [[sourceRow], [{ ...sourceRow, name: "Novo" }]];
    const { password: _p, ...noPw } = input;
    const res = await call("PATCH", `/api/data-sources/${UUID}`, { ...noPw, name: "Novo" });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ id: UUID, name: "Novo" });
    expect(body).not.toHaveProperty("encryptedPassword");
    expect(inspectReadOnlyPostgres).toHaveBeenCalledWith({ host: "h", port: 5432, database: "d", user: "u", password: "pw" });
    expect(vi.mocked(reconcileDataSourceCatalog).mock.calls[0]![4]).toMatchObject({ resetTableContexts: false });
  });
  it("PATCH mudando o host reseta contexto das tabelas", async () => {
    h.state.queue = [[sourceRow], [sourceRow]];
    await call("PATCH", `/api/data-sources/${UUID}`, { ...input, host: "outro" });
    expect(vi.mocked(reconcileDataSourceCatalog).mock.calls[0]![4]).toMatchObject({ resetTableContexts: true });
  });
  it("PATCH 404, 400 e 403", async () => {
    expect((await call("PATCH", `/api/data-sources/${UUID}`, input)).status).toBe(404);
    expect((await call("PATCH", `/api/data-sources/${UUID}`, { name: "x" })).status).toBe(400);
    h.state.user = plain;
    expect((await call("PATCH", `/api/data-sources/${UUID}`, input)).status).toBe(403);
  });
});
