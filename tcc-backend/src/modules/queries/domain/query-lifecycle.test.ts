import { describe, expect, it } from "vitest";
import type {
  QueryLifecycleQuery,
  QueryLifecycleRepository,
  QueryLifecycleSource,
  QueryLifecycleTransaction,
  QueryTestReceipt,
  QueryTestReceiptInput,
} from "./query-lifecycle.js";
import {
  issueQueryTestReceipt,
  queryDraftFingerprint,
  querySourceTargetHash,
  QueryLifecycleError,
  saveQueryWithTestReceipt,
} from "./query-lifecycle.js";

const actorId = "00000000-0000-4000-8000-000000000001";
const sourceId = "00000000-0000-4000-8000-000000000002";
const queryId = "00000000-0000-4000-8000-000000000003";
const receiptId = "00000000-0000-4000-8000-000000000004";
const now = new Date("2026-09-29T12:00:00.000Z");
const source: QueryLifecycleSource = {
  id: sourceId,
  updatedAt: new Date("2026-09-29T11:00:00.000Z"),
  host: "postgres.internal",
  port: 5432,
  databaseName: "analytics",
  username: "reader",
  encryptedPassword: "encrypted-secret",
};
const parameters = [
  { name: "start", label: "Início", type: "date" as const, required: true },
];
const queryDraft = {
  dataSourceId: sourceId,
  sqlText: "SELECT count(*) FROM public.orders WHERE created_at >= {{start}}",
  parameters,
};

function makeRepository() {
  const state = {
    sources: new Map([[sourceId, structuredClone(source)]]),
    queries: new Map<string, QueryLifecycleQuery>(),
    receipts: new Map<string, QueryTestReceipt>(),
  };
  const repository: QueryLifecycleRepository = {
    async transaction(operation) {
      const staged = structuredClone(state);
      const tx: QueryLifecycleTransaction = {
        async lockSource(id) {
          return staged.sources.get(id);
        },
        async lockQuery(id) {
          return staged.queries.get(id);
        },
        async insertReceipt(input: QueryTestReceiptInput) {
          const receipt: QueryTestReceipt = {
            ...input,
            id: receiptId,
            consumedAt: null,
          };
          staged.receipts.set(receipt.id, receipt);
          return receipt;
        },
        async consumeReceipt(id, actor, at) {
          const receipt = staged.receipts.get(id);
          if (
            !receipt ||
            receipt.actorId !== actor ||
            receipt.consumedAt ||
            receipt.expiresAt <= at
          )
            return undefined;
          const consumed = { ...receipt, consumedAt: at };
          staged.receipts.set(id, consumed);
          return consumed;
        },
        async insertQuery(input) {
          const query: QueryLifecycleQuery = {
            ...input,
            id: queryId,
            createdAt: now,
            updatedAt: now,
          };
          staged.queries.set(query.id, query);
          return query;
        },
        async updateQuery(id, update) {
          const current = staged.queries.get(id);
          if (!current) return undefined;
          const updated = { ...current, ...update };
          staged.queries.set(id, updated);
          return updated;
        },
      };
      const result = await operation(tx);
      state.sources = staged.sources;
      state.queries = staged.queries;
      state.receipts = staged.receipts;
      return result;
    },
  };
  return { repository, state };
}

function receiptInput(mode: "create" | "update" = "create") {
  return {
    actorId,
    dataSourceId: sourceId,
    sourceUpdatedAt: source.updatedAt,
    sourceTargetHash: querySourceTargetHash(source),
    draftFingerprint: queryDraftFingerprint(queryDraft),
    mode,
    ...(mode === "update" ? { queryId, queryUpdatedAt: now } : {}),
    now,
  };
}

describe("query preview receipts", () => {
  it("fingerprints the canonical SQL and parameter definitions without values", () => {
    expect(
      queryDraftFingerprint({
        ...queryDraft,
        sqlText: `\n${queryDraft.sqlText}\r\n`,
      }),
    ).toBe(queryDraftFingerprint(queryDraft));
    expect(
      queryDraftFingerprint({
        ...queryDraft,
        parameters: [...parameters].reverse(),
      }),
    ).toBe(queryDraftFingerprint(queryDraft));
    expect(
      queryDraftFingerprint({
        ...queryDraft,
        sqlText:
          "SELECT count(*) FROM public.orders WHERE created_at >= {{start}} /* changed */",
      }),
    ).not.toBe(queryDraftFingerprint(queryDraft));
  });

  it("requires a matching receipt and consumes it once in the same transaction as create", async () => {
    const { repository, state } = makeRepository();
    const testRunId = await issueQueryTestReceipt(repository, receiptInput());
    const saved = await saveQueryWithTestReceipt(repository, {
      receiptId: testRunId,
      actorId,
      mode: "create",
      ...queryDraft,
      name: "Pedidos",
      createdBy: actorId,
      now,
    });

    expect(saved.name).toBe("Pedidos");
    expect(state.queries.size).toBe(1);
    expect(state.receipts.get(testRunId)?.consumedAt).toEqual(now);
    await expect(
      saveQueryWithTestReceipt(repository, {
        receiptId: testRunId,
        actorId,
        mode: "create",
        ...queryDraft,
        name: "Replay",
        createdBy: actorId,
        now,
      }),
    ).rejects.toMatchObject({ code: "RECEIPT_INVALID" });
    expect(state.queries.size).toBe(1);
  });

  it("rolls back receipt consumption when the actor or draft does not match", async () => {
    const { repository, state } = makeRepository();
    const testRunId = await issueQueryTestReceipt(repository, receiptInput());
    await expect(
      saveQueryWithTestReceipt(repository, {
        receiptId: testRunId,
        actorId: "00000000-0000-4000-8000-000000000099",
        mode: "create",
        ...queryDraft,
        name: "Tampered",
        createdBy: actorId,
        now,
      }),
    ).rejects.toMatchObject({ code: "RECEIPT_INVALID" });
    expect(state.queries.size).toBe(0);
    expect(state.receipts.get(testRunId)?.consumedAt).toBeNull();

    await expect(
      saveQueryWithTestReceipt(repository, {
        receiptId: testRunId,
        actorId,
        mode: "create",
        ...queryDraft,
        sqlText: "SELECT 2 AS changed",
        name: "Tampered",
        createdBy: actorId,
        now,
      }),
    ).rejects.toMatchObject({ code: "RECEIPT_STALE" });
    expect(state.queries.size).toBe(0);
    expect(state.receipts.get(testRunId)?.consumedAt).toBeNull();
  });

  it("detects a stale update atomically and increments updatedAt monotonically", async () => {
    const { repository, state } = makeRepository();
    const existing: QueryLifecycleQuery = {
      id: queryId,
      dataSourceId: sourceId,
      name: "Anterior",
      sqlText: "SELECT 1",
      parameters: [],
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    };
    state.queries.set(queryId, existing);
    const testRunId = await issueQueryTestReceipt(
      repository,
      receiptInput("update"),
    );
    const conflictAt = new Date(now.getTime() + 2);
    state.queries.set(queryId, {
      ...existing,
      name: "Mudou em outra sessão",
      updatedAt: conflictAt,
    });

    await expect(
      saveQueryWithTestReceipt(repository, {
        receiptId: testRunId,
        actorId,
        mode: "update",
        queryId,
        expectedUpdatedAt: now,
        ...queryDraft,
        name: "Nova versão",
        createdBy: actorId,
        now,
      }),
    ).rejects.toBeInstanceOf(QueryLifecycleError);
    expect(state.queries.get(queryId)?.name).toBe("Mudou em outra sessão");
    expect(state.receipts.get(testRunId)?.consumedAt).toBeNull();

    const retryRunId = await issueQueryTestReceipt(repository, {
      ...receiptInput("update"),
      queryUpdatedAt: conflictAt,
    });
    const updated = await saveQueryWithTestReceipt(repository, {
      receiptId: retryRunId,
      actorId,
      mode: "update",
      queryId,
      expectedUpdatedAt: conflictAt,
      ...queryDraft,
      name: "Nova versão",
      createdBy: actorId,
      now: conflictAt,
    });
    expect(updated.updatedAt.getTime()).toBe(conflictAt.getTime() + 1);
  });

  it("rejects an expired receipt without writing", async () => {
    const { repository, state } = makeRepository();
    const testRunId = await issueQueryTestReceipt(repository, {
      ...receiptInput(),
      now: new Date(now.getTime() - 20 * 60 * 1_000),
    });
    await expect(
      saveQueryWithTestReceipt(repository, {
        receiptId: testRunId,
        actorId,
        mode: "create",
        ...queryDraft,
        name: "Expirada",
        createdBy: actorId,
        now,
      }),
    ).rejects.toMatchObject({ code: "RECEIPT_INVALID" });
    expect(state.queries.size).toBe(0);
  });
});
