import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "./auth.js";
import type { AiReadSource, AiToolProgressEvent } from "./ai-read-tools.js";
import {
  createAiQueryTestTools,
  AI_QUERY_TEST_LIMITS,
  type AiQueryTestResult,
  type AiQueryTestRepository,
} from "./ai-query-tools.js";
import { ExternalQueryExecutionError } from "./external-postgres.js";

const sourceId = "00000000-0000-4000-8000-000000000001";
const admin: AuthenticatedUser = {
  id: "00000000-0000-4000-8000-000000000099",
  name: "Admin",
  email: "admin@example.test",
  isAdmin: true,
  permissions: [],
};
const source: AiReadSource = {
  id: sourceId,
  name: "Analytics",
  databaseName: "analytics",
  context: "",
  connection: {
    host: "db.internal.test",
    port: 5432,
    database: "analytics",
    user: "readonly_user",
    password: "credential-that-must-never-reach-model",
  },
};

function makeTools(
  options: {
    currentUser?: AuthenticatedUser;
    runQuery?: Parameters<typeof createAiQueryTestTools>[0]["runQuery"];
    onToolEvent?: Parameters<typeof createAiQueryTestTools>[0]["onToolEvent"];
    repository?: Partial<
      Parameters<typeof createAiQueryTestTools>[0]["repository"]
    >;
  } = {},
) {
  const findSource = vi.fn(async (requestedId: string) =>
    requestedId === sourceId ? source : undefined,
  );
  const repository = Object.assign({
    findSource,
    listCatalogTables: async () => [
      {
        id: "00000000-0000-4000-8000-000000000003",
        dataSourceId: sourceId,
        schemaName: "public",
        tableName: "orders",
      },
    ],
    listLiveBaseTables: async () => [
      { schemaName: "public", tableName: "orders" },
    ],
    findUnsafeColumnTypes: async () => [],
    findSourceVersion: async () => ({
      updatedAt: new Date("2026-09-29T12:00:00.000Z"),
      targetHash: "a".repeat(64),
    }),
    findQueryTarget: async () => undefined,
    createTestReceipt: async () => "00000000-0000-4000-8000-000000000010",
  }, options.repository);
  const tools = createAiQueryTestTools({
    currentUser: options.currentUser ?? admin,
    repository,
    runQuery: options.runQuery,
    onToolEvent: options.onToolEvent,
  });
  const testQuery = tools.find((item) => item.name === "test_query");
  if (!testQuery) throw new Error("test_query tool not found");
  return { testQuery, findSource, repository };
}

function resultObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string")
    return JSON.parse(value) as Record<string, unknown>;
  if (value && typeof value === "object" && "content" in value) {
    const content = (value as { content: unknown }).content;
    if (typeof content === "string")
      return JSON.parse(content) as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

const queryResult: AiQueryTestResult = {
  rows: [{ total: "4" }],
  rowLimit: 50,
  byteLimit: 48_000,
  bytes: 13,
  truncated: false,
  truncationReason: null,
};

describe("ferramenta LangChain test_query", () => {
  it("só é registrada para administradores", () => {
    expect(() =>
      makeTools({ currentUser: { ...admin, isAdmin: false } }),
    ).toThrow("apenas para administradores");
  });

  it("liga parâmetros declarados, usa a fonte cadastrada e não devolve credenciais", async () => {
    const runQuery = vi.fn(async () => queryResult);
    const { testQuery } = makeTools({ runQuery });
    const output = resultObject(
      await testQuery.invoke({
        dataSourceId: sourceId,
        purpose: "quick_query",
        sqlText:
          "SELECT count(*) AS total FROM public.orders WHERE created_at >= {{start_date}}",
        parameters: [
          {
            name: "start_date",
            label: "Data inicial",
            type: "date",
            required: true,
          },
        ],
        values: { start_date: "2026-09-01" },
      } as never),
    );

    expect(runQuery).toHaveBeenCalledWith(
      source,
      "SELECT count(*) AS total FROM public.orders WHERE created_at >= $1",
      ["2026-09-01"],
      expect.any(Function),
      undefined,
    );
    expect(output).toMatchObject({
      ok: true,
      rows: [{ total: "4" }],
      rowCount: 1,
      truncated: false,
    });
    expect(JSON.stringify(output)).not.toContain(
      "credential-that-must-never-reach-model",
    );
    expect(JSON.stringify(output)).not.toContain("db.internal.test");
  });

  it("emite a prévia tipada com o recibo e valores apenas transitórios do teste", async () => {
    const events: AiToolProgressEvent[] = [];
    const createTestReceipt = vi.fn(async (_input: Parameters<AiQueryTestRepository["createTestReceipt"]>[0]) => "00000000-0000-4000-8000-000000000010");
    const { testQuery } = makeTools({
      runQuery: vi.fn(async () => queryResult),
      repository: { createTestReceipt },
      onToolEvent: (event) => { events.push(event); },
    });
    const output = resultObject(await testQuery.invoke({
      dataSourceId: sourceId,
      sqlText: "SELECT count(*) FROM public.orders",
      purpose: "quick_query",
      parameters: [],
      values: {},
    } as never, { toolCallId: "tool-call-1" } as never));

    expect(createTestReceipt).toHaveBeenCalledWith(expect.objectContaining({
      actorId: admin.id,
      dataSourceId: sourceId,
      mode: "create",
      queryId: undefined,
      queryUpdatedAt: undefined,
    }));
    expect(output).toMatchObject({ testRunId: "00000000-0000-4000-8000-000000000010" });
    expect(events.map((event) => event.type)).toEqual([
      "tool_start",
      "query_preview",
      "tool_result",
    ]);
    const preview = events[1];
    expect(preview).toMatchObject({
      type: "query_preview",
      toolCallId: "tool-call-1",
      testRunId: "00000000-0000-4000-8000-000000000010",
      sqlText: "SELECT count(*) FROM public.orders",
      testValues: {},
      rows: queryResult.rows,
      rowCount: 1,
      rowLimit: queryResult.rowLimit,
      truncated: false,
    });
    expect(JSON.stringify(createTestReceipt.mock.calls[0]?.[0])).not.toContain("2026-09-01");
  });

  it("liga recibo de edição à versão atual da query", async () => {
    const targetId = "00000000-0000-4000-8000-000000000020";
    const updatedAt = new Date("2026-09-29T13:00:00.000Z");
    const createTestReceipt = vi.fn(async (_input: Parameters<AiQueryTestRepository["createTestReceipt"]>[0]) => "00000000-0000-4000-8000-000000000021");
    const { testQuery } = makeTools({
      runQuery: vi.fn(async () => queryResult),
      repository: {
        createTestReceipt,
        findQueryTarget: async () => ({ id: targetId, dataSourceId: sourceId, name: "Pedidos", updatedAt }),
      },
    });
    const output = resultObject(await testQuery.invoke({
      dataSourceId: sourceId,
      mode: "update",
      queryId: targetId,
      sqlText: "SELECT count(*) FROM public.orders",
      purpose: "quick_query",
      parameters: [],
      values: {},
    } as never));

    expect(createTestReceipt).toHaveBeenCalledWith(expect.objectContaining({
      mode: "update",
      queryId: targetId,
      queryUpdatedAt: updatedAt,
    }));
    expect(output).toMatchObject({
      intent: { mode: "update", queryId: targetId, queryName: "Pedidos", queryUpdatedAt: updatedAt.toISOString() },
    });
  });

  it("descarta resposta SQL concluída após abort sem resultado de tool", async () => {
    const controller = new AbortController();
    const events: Array<{ type: string; ok?: boolean }> = [];
    const runQuery = vi.fn(
      async (
        _source,
        _sqlText,
        _values,
        _beforeAttempt,
        signal?: AbortSignal,
      ) => {
        expect(signal).toBe(controller.signal);
        controller.abort();
        return queryResult;
      },
    );
    const { testQuery, findSource } = makeTools({
      runQuery,
      onToolEvent: (event) => {
        events.push(event);
      },
    });

    await expect(
      testQuery.invoke(
        {
          dataSourceId: sourceId,
          sqlText: "SELECT count(*) FROM public.orders",
          purpose: "quick_query",
          parameters: [],
          values: {},
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(findSource).toHaveBeenCalledTimes(2);
    expect(events.map(({ type }) => type)).toEqual(["tool_start"]);
  });

  it("devolve pergunta de esclarecimento e não tenta SQL sem parâmetro obrigatório", async () => {
    const runQuery = vi.fn(async () => queryResult);
    const events: Array<{ type: string; ok?: boolean }> = [];
    const { testQuery } = makeTools({
      runQuery,
      onToolEvent: (event) => {
        events.push(event);
      },
    });
    const output = resultObject(
      await testQuery.invoke({
        dataSourceId: sourceId,
        purpose: "quick_query",
        sqlText:
          "SELECT * FROM public.orders WHERE created_at >= {{start_date}}",
        parameters: [
          {
            name: "start_date",
            label: "Data inicial",
            type: "date",
            required: true,
          },
        ],
        values: {},
      } as never),
    );

    expect(output).toMatchObject({
      ok: false,
      code: "MISSING_PARAMETERS",
      askUser: true,
      retryable: false,
    });
    expect(runQuery).not.toHaveBeenCalled();
    expect(events.map(({ type }) => type)).toEqual([
      "tool_start",
      "tool_result",
    ]);
    expect(events[1]?.ok).toBe(false);
  });

  it("rejeita data inválida e funções fora da allowlist sem consultar o banco", async () => {
    const runQuery = vi.fn(async () => queryResult);
    const { testQuery } = makeTools({ runQuery });
    const invalidDate = resultObject(
      await testQuery.invoke({
        dataSourceId: sourceId,
        purpose: "quick_query",
        sqlText: "SELECT {{start_date}} AS period",
        parameters: [
          { name: "start_date", label: "Data", type: "date", required: false },
        ],
        values: { start_date: "2026-02-30" },
      } as never),
    );
    expect(invalidDate).toMatchObject({
      ok: false,
      code: "INVALID_PARAMETERS",
    });

    const customFunction = resultObject(
      await testQuery.invoke({
        dataSourceId: sourceId,
        purpose: "quick_query",
        sqlText: "SELECT public.send_webhook('https://example.test')",
        parameters: [],
        values: {},
      } as never),
    );
    expect(customFunction).toMatchObject({ ok: false, code: "INVALID_SQL" });

    const unknownView = resultObject(
      await testQuery.invoke({
        dataSourceId: sourceId,
        purpose: "quick_query",
        sqlText: "SELECT * FROM public.unregistered_view",
        parameters: [],
        values: {},
      } as never),
    );
    expect(unknownView).toMatchObject({ ok: false, code: "INVALID_SQL" });
    expect(runQuery).not.toHaveBeenCalled();
  });

  it.each([
    ["base custom", "b", "custom_scalar", "SELECT id FROM public.orders"],
    [
      "base custom projetado",
      "b",
      "custom_scalar",
      "SELECT payload FROM public.orders",
    ],
    ["domain", "d", "order_code", "SELECT code FROM public.orders"],
    ["enum", "e", "order_state", "SELECT status FROM public.orders"],
    ["composite", "c", "shipping_address", "SELECT id FROM public.orders"],
    [
      "array de tipo custom",
      "b",
      "_order_state",
      "SELECT id FROM public.orders",
    ],
  ])(
    "recusa tabelas referenciadas com qualquer coluna de tipo %s, mesmo fora da projeção",
    async (_typeLabel, typeKind, typeName, sqlText) => {
      const runQuery = vi.fn(async () => queryResult);
      const findUnsafeColumnTypes = vi.fn(async () => [
        {
          schemaName: "public",
          tableName: "orders",
          columnName: "payload",
          typeSchema: "public",
          typeName,
          typeKind,
        },
      ]);
      const { testQuery } = makeTools({
        runQuery,
        repository: { findUnsafeColumnTypes },
      });
      const output = resultObject(
        await testQuery.invoke({
          dataSourceId: sourceId,
          purpose: "quick_query",
          sqlText,
          parameters: [],
          values: {},
        } as never),
      );

      expect(output).toMatchObject({
        ok: false,
        code: "UNSUPPORTED_TABLE_TYPES",
        retryable: false,
      });
      expect(runQuery).not.toHaveBeenCalled();
      expect(findUnsafeColumnTypes).toHaveBeenCalledWith(source.connection, [
        { schemaName: "public", tableName: "orders" },
      ]);
    },
  );

  it("aborta se a configuração da fonte mudar entre leitura do catálogo e execução", async () => {
    const runQuery = vi.fn(async () => queryResult);
    let reads = 0;
    const findSource = vi.fn(async () => {
      reads += 1;
      return reads === 1
        ? source
        : {
            ...source,
            connection: { ...source.connection, host: "changed.internal.test" },
          };
    });
    const { testQuery } = makeTools({ runQuery, repository: { findSource } });
    const output = resultObject(
      await testQuery.invoke({
        dataSourceId: sourceId,
        sqlText: "SELECT count(*) FROM public.orders",
        purpose: "quick_query",
        parameters: [],
        values: {},
      } as never),
    );

    expect(output).toMatchObject({ ok: false, code: "DATA_SOURCE_CHANGED" });
    expect(runQuery).not.toHaveBeenCalled();
    expect(findSource).toHaveBeenCalledTimes(2);
  });

  it("descarta a amostra se o alvo da fonte mudar enquanto a consulta executa", async () => {
    const runQuery = vi.fn(async () => queryResult);
    let reads = 0;
    const findSource = vi.fn(async () => {
      reads += 1;
      return reads === 3
        ? {
            ...source,
            connection: { ...source.connection, database: "new_analytics" },
          }
        : source;
    });
    const { testQuery } = makeTools({ runQuery, repository: { findSource } });
    const output = resultObject(
      await testQuery.invoke({
        dataSourceId: sourceId,
        sqlText: "SELECT count(*) FROM public.orders",
        purpose: "quick_query",
        parameters: [],
        values: {},
      } as never),
    );

    expect(output).toMatchObject({ ok: false, code: "DATA_SOURCE_CHANGED" });
    expect(output).not.toHaveProperty("rows");
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(findSource).toHaveBeenCalledTimes(3);
  });

  it("permite refinar a query até o limite de execuções PostgreSQL da rodada", async () => {
    let attempts = 0;
    const runQuery = vi.fn(async (_source, _sql, _values, beforeAttempt) => {
      expect(beforeAttempt(1)).toBe(true);
      attempts += 1;
      expect(beforeAttempt(2)).toBe(true);
      attempts += 1;
      return queryResult;
    });
    const { testQuery } = makeTools({ runQuery });

    for (const sqlText of Array.from({ length: 6 }, (_, index) => `SELECT ${index + 1} AS value`)) {
      const output = resultObject(
        await testQuery.invoke({
          dataSourceId: sourceId,
          purpose: "quick_query",
          sqlText,
          parameters: [],
          values: {},
        } as never),
      );
      expect(output.ok).toBe(true);
    }
    const overLimit = resultObject(
      await testQuery.invoke({
        dataSourceId: sourceId,
        purpose: "quick_query",
        sqlText: "SELECT 7 AS value",
        parameters: [],
        values: {},
      } as never),
    );

    expect(AI_QUERY_TEST_LIMITS).toMatchObject({
      maxSqlDraftCharacters: 100_000,
      maxDatabaseAttempts: 12,
    });
    expect(overLimit).toMatchObject({
      ok: false,
      code: "DATABASE_ATTEMPT_LIMIT_REACHED",
      askUser: false,
    });
    expect(runQuery).toHaveBeenCalledTimes(6);
    expect(attempts).toBe(12);
  });

  it("serializa falhas de timeout e de transporte sem expor mensagem PostgreSQL bruta", async () => {
    const rawDatabaseMessage =
      "canceling statement due to statement timeout at db.internal.test";
    const runQuery = vi.fn(async () => {
      throw new ExternalQueryExecutionError("timeout", "57014", false);
    });
    const events: Array<{ type: string; ok?: boolean }> = [];
    const { testQuery } = makeTools({
      runQuery,
      onToolEvent: (event) => {
        events.push(event);
      },
    });
    const output = resultObject(
      await testQuery.invoke({
        dataSourceId: sourceId,
        sqlText: "SELECT count(*) FROM public.orders",
        purpose: "quick_query",
        parameters: [],
        values: {},
      } as never),
    );

    expect(output).toMatchObject({
      ok: false,
      code: "QUERY_TIMEOUT",
      sqlState: "57014",
      retryable: false,
    });
    expect(JSON.stringify(output)).not.toContain(rawDatabaseMessage);
    expect(events[1]?.ok).toBe(false);
  });
});
