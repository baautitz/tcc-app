import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://u:p@localhost:5432/x";
  process.env.CREDENTIAL_ENCRYPTION_KEY = "a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s=";
  const state = {
    queue: [] as unknown[],
    user: null as null | { id: string; name: string; email: string; isAdmin: boolean; permissions: string[] },
    dashboards: [] as unknown[],
  };
  // Chainable, awaitable fake: every method returns the chain; awaiting pops the next queued result.
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

vi.mock("../shared/db/client.js", () => ({ db: h.fakeDb, pool: {} }));
vi.mock("../modules/identity/application/auth.js", async (orig) => ({
  ...(await orig<typeof import("../modules/identity/application/auth.js")>()),
  findAuthenticatedUser: vi.fn(async (token?: string) => (token ? h.state.user : null)),
  createSession: vi.fn(async () => ({ token: "tok", expiresAt: new Date(Date.now() + 1e6) })),
  revokeSession: vi.fn(async () => {}),
}));
vi.mock("../shared/lib/passwords.js", () => ({
  hashPassword: (p: string) => `hash:${p}`,
  verifyPassword: (p: string, hash: string) => hash === `hash:${p}`,
}));
vi.mock("../modules/identity/application/permissions.js", () => ({ assignPermissionKeys: vi.fn(async () => {}), ensureSystemPermissions: vi.fn() }));
vi.mock("../modules/dashboards/domain/dashboards.js", async (orig) => ({
  ...(await orig<typeof import("../modules/dashboards/domain/dashboards.js")>()),
  getRegisteredDashboards: vi.fn(async () => h.state.dashboards),
  syncDashboardDirectory: vi.fn(async () => ({ synced: 0 })),
}));
vi.mock("../modules/data-sources/infrastructure/external-pg/index.js", async (orig) => ({
  ...(await orig<typeof import("../modules/data-sources/infrastructure/external-pg/index.js")>()),
  runReadOnlyQuery: vi.fn(async () => [{ n: 1 }]),
}));

import { app } from "../app.js";
import { encryptCredential } from "../shared/lib/credentials.js";

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

beforeEach(() => {
  h.state.queue = [];
  h.state.user = admin;
  h.state.dashboards = [];
});

describe("auth", () => {
  it("login ok seta cookie e devolve usuário", async () => {
    h.state.queue = [[{ id: UUID, email: "a@x.com", active: true, passwordHash: "hash:pw" }]];
    const res = await call("POST", "/api/auth/login", { email: "A@x.com", password: "pw" }, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: admin });
    expect(res.headers.get("set-cookie")).toContain("tcc_session=tok");
  });
  it("login com senha errada -> 401", async () => {
    h.state.queue = [[{ id: UUID, active: true, passwordHash: "hash:other" }]];
    const res = await call("POST", "/api/auth/login", { email: "a@x.com", password: "pw" }, {});
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "E-mail ou senha inválidos." });
  });
  it("login com usuário inexistente -> 401", async () => {
    expect((await call("POST", "/api/auth/login", { email: "a@x.com", password: "pw" }, {})).status).toBe(401);
  });
  it("login com corpo inválido -> 400 com details", async () => {
    const res = await call("POST", "/api/auth/login", { email: "nope" }, {});
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string; details: unknown }).error).toMatch(/^Dados inválidos/);
  });
  it("login com JSON malformado -> 400", async () => {
    const res = await app.request("/api/auth/login", { method: "POST", body: "{x" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "O corpo da requisição deve ser JSON válido." });
  });
  it("logout -> 204", async () => {
    expect((await call("POST", "/api/auth/logout")).status).toBe(204);
  });
  it("me autenticado -> 200", async () => {
    const res = await call("GET", "/api/auth/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: admin });
  });
  it("me sem sessão -> 401", async () => {
    const res = await call("GET", "/api/auth/me", undefined, {});
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sessão inválida, expirada ou revogada." });
  });
  it("health", async () => {
    expect((await app.request("/api/health")).status).toBe(200);
  });
});

describe("users/permissions", () => {
  it("GET /api/users lista com permissões", async () => {
    h.state.queue = [
      [{ user: { id: UUID2, name: "Bob", email: "b@x.com", isAdmin: false, active: true, createdAt: "t" } }],
      [{ userId: UUID2, key: "users:read" }],
    ];
    const res = await call("GET", "/api/users");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: UUID2, name: "Bob", email: "b@x.com", isAdmin: false, active: true, createdAt: "t", permissions: ["users:read"] }]);
  });
  it("GET /api/users sem permissão -> 403", async () => {
    h.state.user = plain;
    const res = await call("GET", "/api/users");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Acesso negado: a permissão 'users:read' é necessária." });
  });
  it("POST /api/users -> 201", async () => {
    h.state.queue = [[{ id: UUID2 }]];
    const res = await call("POST", "/api/users", { name: "Bob", email: "B@x.com", password: "Senha-Forte-123!" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: UUID2 });
  });
  it("POST /api/users inválido -> 400", async () => {
    expect((await call("POST", "/api/users", { name: "B" })).status).toBe(400);
  });
  it("PATCH /api/users/:id inexistente -> 404", async () => {
    const res = await call("PATCH", `/api/users/${UUID2}`, { name: "Novo" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Usuário não encontrado." });
  });
  it("PATCH /api/users/:id ok", async () => {
    h.state.queue = [[{ id: UUID2 }]];
    const res = await call("PATCH", `/api/users/${UUID2}`, { name: "Novo" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: UUID2 });
  });
  it("DELETE próprio usuário -> 400", async () => {
    const res = await call("DELETE", `/api/users/${UUID}`);
    expect(res.status).toBe(400);
  });
  it("DELETE ok -> 204 e inexistente -> 404", async () => {
    h.state.queue = [[{ id: UUID2 }]];
    expect((await call("DELETE", `/api/users/${UUID2}`)).status).toBe(204);
    expect((await call("DELETE", `/api/users/${UUID2}`)).status).toBe(404);
  });
  it("GET /api/permissions", async () => {
    h.state.queue = [[{ key: "users:read" }]];
    const res = await call("GET", "/api/permissions");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ key: "users:read" }]);
    h.state.user = plain;
    expect((await call("GET", "/api/permissions")).status).toBe(403);
  });
});

const sourceRow = {
  id: UUID, name: "S", host: "h", port: 5432, databaseName: "d", username: "u",
  encryptedPassword: encryptCredential("pw", "a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s="), context: null, updatedAt: new Date(),
};

describe("data-sources", () => {
  it("lista sem encryptedPassword", async () => {
    h.state.queue = [[sourceRow]];
    const res = await call("GET", "/api/data-sources");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>[];
    expect(body[0]).toMatchObject({ id: UUID, name: "S" });
    expect(body[0]).not.toHaveProperty("encryptedPassword");
  });
  it("detalhe com tabelas", async () => {
    h.state.queue = [[sourceRow], [{ id: UUID2, tableName: "t" }]];
    const res = await call("GET", `/api/data-sources/${UUID}`);
    expect(res.status).toBe(200);
    expect((await res.json() as { tables: unknown[] }).tables).toHaveLength(1);
  });
  it("detalhe 404", async () => {
    const res = await call("GET", `/api/data-sources/${UUID}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Servidor PostgreSQL não encontrado." });
  });
  it("id não-uuid -> 400", async () => {
    expect((await call("GET", "/api/data-sources/xyz")).status).toBe(400);
  });
  it("sem permissão -> 403", async () => {
    h.state.user = plain;
    expect((await call("GET", "/api/data-sources")).status).toBe(403);
  });
  it("POST inválido -> 400", async () => {
    expect((await call("POST", "/api/data-sources", {})).status).toBe(400);
  });
  it("DELETE sem permissão -> 403", async () => {
    h.state.user = plain;
    expect((await call("DELETE", `/api/data-sources/${UUID}`)).status).toBe(403);
  });
});

const queryRow = {
  id: UUID2, dataSourceId: UUID, name: "Q", sqlText: "select 1 as n", parameters: [], createdAt: "t", updatedAt: "t",
};

describe("queries", () => {
  it("lista", async () => {
    h.state.queue = [[{ id: UUID2, name: "Q" }]];
    const res = await call("GET", "/api/queries");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: UUID2, name: "Q" }]);
  });
  it("detalhe ok / 404", async () => {
    h.state.queue = [[queryRow]];
    expect(await (await call("GET", `/api/queries/${UUID2}`)).json()).toEqual(queryRow);
    const res = await call("GET", `/api/queries/${UUID2}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Query não encontrada." });
  });
  it("sem permissão -> 403", async () => {
    h.state.user = plain;
    expect((await call("GET", "/api/queries")).status).toBe(403);
    expect((await call("POST", "/api/queries", {})).status).toBe(403);
  });
  it("POST inválido -> 400", async () => {
    expect((await call("POST", "/api/queries", { name: "x" })).status).toBe(400);
  });
  it("POST /test sem permissões de escrita -> 403", async () => {
    h.state.user = plain;
    expect((await call("POST", "/api/queries/test", {})).status).toBe(403);
  });
  it("POST /test corpo inválido -> 400", async () => {
    expect((await call("POST", "/api/queries/test", {})).status).toBe(400);
  });
  it("DELETE inexistente -> 404", async () => {
    const res = await call("DELETE", `/api/queries/${UUID2}`);
    expect(res.status).toBe(404);
  });
  it.skip("POST /api/queries/test e persistência com recibo exigem Postgres real", () => {});
});

describe("dashboards", () => {
  it("lista para admin", async () => {
    h.state.dashboards = [{ id: UUID, name: "D", description: "x" }];
    const res = await call("GET", "/api/dashboards");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: UUID, name: "D", description: "x" }]);
  });
  it("lista vazia para não-admin sem vínculo", async () => {
    h.state.user = plain;
    h.state.dashboards = [{ id: UUID, name: "D" }];
    h.state.queue = [[]];
    expect(await (await call("GET", "/api/dashboards")).json()).toEqual([]);
  });
  it("detalhe 404 e 401", async () => {
    expect((await call("GET", `/api/dashboards/${UUID}`)).status).toBe(404);
    expect((await call("GET", `/api/dashboards/${UUID}`, undefined, {})).status).toBe(401);
  });
  it("detalhe 403 para não-admin sem vínculo", async () => {
    h.state.user = plain;
    h.state.dashboards = [{ id: UUID, name: "D" }];
    h.state.queue = [[]];
    const res = await call("GET", `/api/dashboards/${UUID}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "O usuário não possui acesso a este dashboard." });
  });
  it("rotas admin -> 403 para não-admin", async () => {
    h.state.user = plain;
    expect((await call("POST", "/api/dashboards/sync")).status).toBe(403);
    expect((await call("GET", `/api/admin/dashboards/${UUID}`)).status).toBe(403);
    expect((await call("POST", "/api/admin/dashboards", {})).status).toBe(403);
  });
  it("POST /api/dashboards/sync admin", async () => {
    const res = await call("POST", "/api/dashboards/sync");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ synced: 0 });
  });
  it("POST /api/admin/dashboards inválido -> 400", async () => {
    expect((await call("POST", "/api/admin/dashboards", {})).status).toBe(400);
  });
});

describe("/query/:uuid", () => {
  it("200 para admin", async () => {
    h.state.queue = [[queryRow], [{ id: UUID2 }], [sourceRow]];
    const res = await call("GET", `/query/${UUID2}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [{ n: 1 }] });
  });
  it("403 para não-admin sem dashboard vinculado", async () => {
    h.state.user = plain;
    h.state.queue = [[queryRow], []];
    const res = await call("GET", `/query/${UUID2}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "A query não está vinculada a nenhum dashboard acessível por este usuário." });
  });
  it("404 e 401", async () => {
    expect((await call("GET", `/query/${UUID2}`)).status).toBe(404);
    expect((await call("GET", `/query/${UUID2}`, undefined, {})).status).toBe(401);
  });
});

describe("admin ai", () => {
  it("não-admin -> 403 em chat e context-proposals", async () => {
    h.state.user = plain;
    expect((await call("POST", "/api/admin/ai/chat", {})).status).toBe(403);
    expect((await call("GET", "/api/admin/ai/context-proposals")).status).toBe(403);
    expect((await call("POST", `/api/admin/ai/context-proposals/${UUID}/approve`)).status).toBe(403);
    expect((await call("POST", `/api/admin/ai/dashboard-proposals/${UUID}/commit`, {})).status).toBe(403);
  });
  it("sem sessão -> 401", async () => {
    expect((await call("POST", "/api/admin/ai/chat", {}, {})).status).toBe(401);
  });
  it("proposal id inválido -> 400", async () => {
    expect((await call("GET", "/api/admin/ai/context-proposals/xyz")).status).toBe(400);
  });
  it("lista de propostas de contexto vazia", async () => {
    const res = await call("GET", "/api/admin/ai/context-proposals");
    expect(res.status).toBe(200);
  });
  it.skip("fluxos de preview/commit de propostas exigem banco/arquivos reais", () => {});
});
