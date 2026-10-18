import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://u:p@localhost:5432/x";
  process.env.CREDENTIAL_ENCRYPTION_KEY = "a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s=";
  const state = {
    queue: [] as unknown[],
    user: null as null | { id: string; name: string; email: string; isAdmin: boolean; permissions: string[] },
    stream: (async function* () {}) as (opts: { signal: AbortSignal }) => AsyncIterable<unknown>,
    toolEvents: null as null | ((e: unknown) => unknown),
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

vi.mock("../shared/db/client.js", () => ({ db: h.fakeDb, pool: {} }));
vi.mock("../modules/identity/application/auth.js", async (orig) => ({
  ...(await orig<typeof import("../modules/identity/application/auth.js")>()),
  findAuthenticatedUser: vi.fn(async (token?: string) => (token ? h.state.user : null)),
}));
vi.mock("../services/ai-agent.js", async (orig) => ({
  ...(await orig<typeof import("../services/ai-agent.js")>()),
  resolveAiConfiguration: vi.fn(() => ({
    enabled: true, baseURL: "https://ai.test/v1", apiKey: "secret-key", model: "m", requestTimeoutMs: 60_000,
  })),
  createAiAgent: vi.fn(() => ({
    stream: async (_i: unknown, opts: { signal: AbortSignal }) => h.state.stream(opts),
  })),
}));

import { app } from "../app.js";

const UUID = "11111111-1111-4111-8111-111111111111";
const admin = { id: UUID, name: "Admin", email: "a@x.com", isAdmin: true, permissions: [] };
const COOKIE = { Cookie: "tcc_session=abc" };
const body = { messages: [{ role: "user", content: "Olá, tudo bem?" }] };

const chat = (b: unknown = body) =>
  app.request("/api/admin/ai/chat", {
    method: "POST",
    headers: { ...COOKIE, "Content-Type": "application/json" },
    body: JSON.stringify(b),
  });

const parse = (wire: string) =>
  wire.split(/\r?\n\r?\n/).flatMap((blk) => {
    const event = blk.match(/^event: ?(.+)$/m)?.[1];
    const data = blk.match(/^data: ?(.+)$/m)?.[1];
    return event && data ? [{ event, data: JSON.parse(data) as Record<string, unknown> }] : [];
  });

const tok = (content: string, finish?: string) =>
  [{ content, response_metadata: finish ? { finish_reason: finish } : {} }, { langgraph_node: "model_request" }];

beforeEach(() => {
  h.state.queue = [];
  h.state.user = admin;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("chat IA SSE via app", () => {
  it("emite start, token(s) e done na ordem, com finishReason", async () => {
    h.state.stream = async function* () {
      yield tok("Oi, ");
      yield tok("tudo bem!", "stop");
      yield [{ content: "ignorado" }, { langgraph_node: "tools" }];
    };
    const res = await chat();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const ev = parse(await res.text());
    expect(ev.map((e) => e.event)).toEqual(["start", "token", "token", "done"]);
    expect(ev[0].data).toMatchObject({ version: 1, type: "start" });
    const msgId = ev[0].data.messageId;
    expect(ev.slice(1, 3).map((e) => e.data.delta).join("")).toBe("Oi, tudo bem!");
    expect(ev[1].data.messageId).toBe(msgId);
    expect(JSON.stringify(ev)).not.toContain("ignorado");
    expect(ev[3].data).toMatchObject({ messageId: msgId, finishReason: "stop" });
  });

  it("erro do provedor -> error AI_PROVIDER_ERROR sem vazar chave, e fim do stream sem done", async () => {
    h.state.stream = async function* () {
      yield tok("parcial");
      throw new Error("boom secret-key");
    };
    const wire = await (await chat()).text();
    const ev = parse(wire);
    expect(ev.map((e) => e.event)).toEqual(["start", "error"]);
    expect(ev[1].data).toMatchObject({ code: "AI_PROVIDER_ERROR", retryable: true });
    expect(wire).not.toContain("secret-key");
  });

  it("resposta vazia -> token de fallback, error AI_EMPTY_RESPONSE sem done", async () => {
    h.state.stream = async function* () {};
    const ev = parse(await (await chat()).text());
    expect(ev.map((e) => e.event)).toEqual(["start", "token", "error"]);
    expect(ev[2].data.code).toBe("AI_EMPTY_RESPONSE");
  });

  it("corpo inválido -> 400 AI_INVALID_REQUEST; JSON quebrado -> 400", async () => {
    const r1 = await chat({ messages: [] });
    expect(r1.status).toBe(400);
    expect((await r1.json()).code).toBe("AI_INVALID_REQUEST");
    const r2 = await app.request("/api/admin/ai/chat", {
      method: "POST",
      headers: { ...COOKIE, "Content-Type": "application/json" },
      body: "{x",
    });
    expect(r2.status).toBe(400);
  });

  it("não-admin -> 403 e sem sessão -> 401", async () => {
    h.state.user = { ...admin, isAdmin: false };
    expect((await chat()).status).toBe(403);
    const res = await app.request("/api/admin/ai/chat", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });
});

describe("propostas de contexto admin (fake db)", () => {
  it("GET inexistente -> erro de domínio (não 200)", async () => {
    const res = await app.request(`/api/admin/ai/context-proposals/${UUID}`, { headers: COOKIE });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
  it("dismiss e approve com id inválido -> 400", async () => {
    for (const a of ["approve", "dismiss"]) {
      const res = await app.request(`/api/admin/ai/context-proposals/xyz/${a}`, { method: "POST", headers: COOKIE });
      expect(res.status).toBe(400);
    }
  });
});
