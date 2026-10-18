import { describe, expect, it, vi } from "vitest";
import type { ExternalPostgresConfig } from "../../data-sources/infrastructure/external-pg/index.js";
import {
  AI_QUERY_STATEMENT_TIMEOUT_MS,
  runBoundedReadOnlyQuery,
  runBoundedReadOnlyQueryWithRetry,
} from "../../data-sources/infrastructure/external-pg/index.js";

const connection: ExternalPostgresConfig = {
  host: "db.internal.test",
  port: 5432,
  database: "analytics",
  user: "readonly_user",
  password: "must-not-leak",
};

function harness(
  options: {
    rows?: Record<string, unknown>[];
    byteLimit?: number;
    readError?: Error & { code?: string };
    connectErrors?: Array<Error & { code?: string }>;
  } = {},
) {
  const statements: string[] = [];
  const cursorQueries: Array<{ sqlText: string; values: unknown[] }> = [];
  let rowIndex = 0;
  let connectIndex = 0;
  const client = {
    connect: vi.fn(async () => {
      const error = options.connectErrors?.[connectIndex++];
      if (error) throw error;
    }),
    query: vi.fn(async (query: unknown) => {
      if (typeof query === "string") statements.push(query);
    }),
    end: vi.fn(async () => undefined),
  };
  const cursor = {
    read: vi.fn(async (_count: number) => {
      if (options.readError) throw options.readError;
      const row = options.rows?.[rowIndex++];
      if (!row) return [];
      const rowJson = JSON.stringify(row);
      const rowBytes = Buffer.byteLength(rowJson, "utf8");
      return [
        {
          __ai_row_json:
            rowBytes <= (options.byteLimit ?? 48_000) ? rowJson : null,
          __ai_row_bytes: rowBytes,
        },
      ];
    }),
    close: vi.fn(async () => undefined),
  };
  const createClient = vi.fn(() => client as never);
  const createCursor = vi.fn((sqlText: string, values: unknown[]) => {
    cursorQueries.push({ sqlText, values });
    return cursor as never;
  });
  return {
    statements,
    cursorQueries,
    client,
    cursor,
    createClient,
    createCursor,
  };
}

describe("execução limitada de consultas da IA", () => {
  it("usa transação READ ONLY, timeout no servidor, query parametrizada e lê cursor uma linha por vez", async () => {
    const h = harness({ rows: [{ id: 1 }, { id: 2 }] });
    const result = await runBoundedReadOnlyQuery(
      connection,
      "SELECT id FROM public.orders ORDER BY id LIMIT 7;",
      ["unused"],
      {
        rowLimit: 2,
        createClient: h.createClient,
        createCursor: h.createCursor,
      },
    );

    expect(h.statements).toEqual([
      "BEGIN READ ONLY",
      `SET LOCAL statement_timeout = '${AI_QUERY_STATEMENT_TIMEOUT_MS}ms'`,
      "SET LOCAL search_path = pg_catalog",
      "COMMIT",
    ]);
    const cursorQuery = h.cursorQueries[0]!.sqlText.replace(/\s+/g, " ").trim();
    expect(cursorQuery).toContain(
      'FROM (SELECT id FROM public.orders ORDER BY id LIMIT 7) AS "__ai_query_source"',
    );
    expect(cursorQuery).toContain("LIMIT 3");
    expect(cursorQuery).toContain("octet_length(encoded.row_json) <= 48000");
    expect(h.cursorQueries[0]!.values).toEqual(["unused"]);
    expect(h.client.query).toHaveBeenCalledTimes(5);
    expect(h.cursor.read).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      rows: [{ id: "1" }, { id: "2" }],
      rowLimit: 2,
      truncated: false,
      truncationReason: null,
    });
    expect(h.client.end).toHaveBeenCalledOnce();
  });

  it("mantém UDFs no teste manual e deixa a política estrita ativa para a IA", async () => {
    const h = harness({ rows: [{ total: 1 }] });
    await expect(runBoundedReadOnlyQuery(
      connection,
      "SELECT public.custom_reporting_function(order_id) AS total FROM public.orders",
      [],
      {
        allowGeneralReadOnlySql: true,
        preserveConfiguredSearchPath: true,
        createClient: h.createClient,
        createCursor: h.createCursor,
      },
    )).resolves.toMatchObject({ rows: [{ total: "1" }] });
    expect(h.statements).not.toContain("SET LOCAL search_path = pg_catalog");
    expect(h.cursorQueries[0]?.sqlText).toContain("public.custom_reporting_function");

    const strict = harness();
    await expect(runBoundedReadOnlyQuery(
      connection,
      "SELECT public.custom_reporting_function(order_id) FROM public.orders",
      [],
      { createClient: strict.createClient, createCursor: strict.createCursor },
    )).rejects.toMatchObject({ name: "QueryInputValidationError" });
    expect(strict.createClient).not.toHaveBeenCalled();
  });

  it("repete uma falha transitória do teste manual sem remover suporte a UDFs", async () => {
    const connectionReset = Object.assign(new Error("connection reset"), {
      code: "ECONNRESET",
    });
    const h = harness({ rows: [{ total: 1 }], connectErrors: [connectionReset] });
    const result = await runBoundedReadOnlyQueryWithRetry(
      connection,
      "SELECT public.custom_reporting_function(order_id) AS total FROM public.orders",
      [],
      {
        allowGeneralReadOnlySql: true,
        preserveConfiguredSearchPath: true,
        createClient: h.createClient,
        createCursor: h.createCursor,
      },
    );

    expect(result.rows).toEqual([{ total: "1" }]);
    expect(h.createClient).toHaveBeenCalledTimes(2);
    expect(h.statements).not.toContain("SET LOCAL search_path = pg_catalog");
    expect(h.cursorQueries[0]?.sqlText).toContain("public.custom_reporting_function");
  });

  it("limita linhas enquanto percorre o cursor e não devolve a linha excedente", async () => {
    const h = harness({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] });
    const result = await runBoundedReadOnlyQuery(
      connection,
      "SELECT id FROM orders",
      [],
      {
        rowLimit: 2,
        createClient: h.createClient,
        createCursor: h.createCursor,
      },
    );

    expect(result.rows).toEqual([{ id: "1" }, { id: "2" }]);
    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toBe("row_limit");
    expect(h.cursor.read).toHaveBeenCalledTimes(3);
  });

  it("aplica o teto de bytes incrementalmente antes de incluir uma linha na amostra", async () => {
    const h = harness({
      rows: [{ value: "x".repeat(100) }, { value: "not fetched" }],
      byteLimit: 32,
    });
    const result = await runBoundedReadOnlyQuery(
      connection,
      "SELECT value FROM data",
      [],
      {
        rowLimit: 2,
        byteLimit: 32,
        createClient: h.createClient,
        createCursor: h.createCursor,
      },
    );

    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toBe("byte_limit");
    expect(h.cursor.read).toHaveBeenCalledOnce();
  });

  it("faz exatamente um retry técnico em falha transitória SQLSTATE classe 08", async () => {
    const retryable = Object.assign(new Error("connection reset"), {
      code: "08006",
    });
    const h = harness({ rows: [{ ok: true }], connectErrors: [retryable] });
    const beforeAttempt = vi.fn(() => true);
    const result = await runBoundedReadOnlyQueryWithRetry(
      connection,
      "SELECT true AS ok",
      [],
      {
        beforeAttempt,
        createClient: h.createClient,
        createCursor: h.createCursor,
      },
    );

    expect(result.rows).toEqual([{ ok: true }]);
    expect(h.createClient).toHaveBeenCalledTimes(2);
    expect(beforeAttempt).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["57014", "statement timeout"],
    ["42501", "permission denied"],
    ["42601", "syntax error"],
  ])(
    "não repete automaticamente erros PostgreSQL %s",
    async (code, message) => {
      const databaseError = Object.assign(new Error(message), { code });
      const h = harness({ readError: databaseError });
      const beforeAttempt = vi.fn(() => true);
      await expect(
        runBoundedReadOnlyQueryWithRetry(connection, "SELECT 1", [], {
          beforeAttempt,
          createClient: h.createClient,
          createCursor: h.createCursor,
        }),
      ).rejects.toMatchObject({ sqlState: code, retryable: false });
      expect(h.createClient).toHaveBeenCalledOnce();
      expect(beforeAttempt).toHaveBeenCalledOnce();
      expect(h.statements).toContain("ROLLBACK");
    },
  );

  it("não tenta a segunda falha técnica mais de uma vez", async () => {
    const first = Object.assign(new Error("reset one"), { code: "ECONNRESET" });
    const second = Object.assign(new Error("reset two"), {
      code: "ECONNRESET",
    });
    const h = harness({ connectErrors: [first, second] });
    const beforeAttempt = vi.fn(() => true);
    await expect(
      runBoundedReadOnlyQueryWithRetry(connection, "SELECT 1", [], {
        beforeAttempt,
        createClient: h.createClient,
        createCursor: h.createCursor,
      }),
    ).rejects.toMatchObject({ category: "connection", retryable: true });
    expect(h.createClient).toHaveBeenCalledTimes(2);
    expect(beforeAttempt).toHaveBeenCalledTimes(2);
  });
});
