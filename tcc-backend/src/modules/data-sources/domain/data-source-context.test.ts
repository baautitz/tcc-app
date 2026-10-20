import { describe, expect, it } from "vitest";
import {
  DataSourceContextVersionConflictError,
  DataSourceTableContextVersionConflictError,
  sourceContextRevisionChanged,
  updateTableContextIfSourceVersionMatches,
  type DataSourceContextDatabase,
  type DataSourceContextTransaction,
} from "./data-source-context.js";

class FakeDataSourceContextDatabase implements DataSourceContextDatabase {
  calls: string[] = [];
  updatedContext:
    { dataSourceId: string; tableId: string; context: string } | undefined;

  constructor(public sourceUpdatedAt: Date | undefined) {}

  async transaction<T>(
    work: (tx: DataSourceContextTransaction) => Promise<T>,
  ): Promise<T> {
    const tx: DataSourceContextTransaction = {
      lockSourceUpdatedAt: async () => {
        this.calls.push("lock-source");
        return this.sourceUpdatedAt;
      },
      updateTableContext: async (
        dataSourceId,
        tableId,
        context,
        expectedVersion,
      ) => {
        this.calls.push("update-table-context");
        this.updatedContext = { dataSourceId, tableId, context };
        if (expectedVersion !== 1) return undefined;
        return { id: tableId, dataSourceId, context };
      },
    };
    return work(tx);
  }
}

describe("edição manual do contexto de tabela", () => {
  it("valida a versão da fonte sob lock antes de escrever o contexto", async () => {
    const database = new FakeDataSourceContextDatabase(
      new Date("2026-09-28T12:00:01.000Z"),
    );

    await expect(
      updateTableContextIfSourceVersionMatches(
        database,
        "source-id",
        "table-id",
        "New context",
        "2026-09-28T12:00:00.000Z",
        1,
      ),
    ).rejects.toBeInstanceOf(DataSourceContextVersionConflictError);

    expect(database.calls).toEqual(["lock-source"]);
    expect(database.updatedContext).toBeUndefined();
  });

  it("permite salvar normalmente quando a versão enviada ainda é atual", async () => {
    const expectedUpdatedAt = "2026-09-28T12:00:00.000Z";
    const database = new FakeDataSourceContextDatabase(
      new Date(expectedUpdatedAt),
    );

    await expect(
      updateTableContextIfSourceVersionMatches(
        database,
        "source-id",
        "table-id",
        "Business meaning",
        expectedUpdatedAt,
        1,
      ),
    ).resolves.toEqual({
      id: "table-id",
      dataSourceId: "source-id",
      context: "Business meaning",
    });

    expect(database.calls).toEqual(["lock-source", "update-table-context"]);
    expect(database.updatedContext).toEqual({
      dataSourceId: "source-id",
      tableId: "table-id",
      context: "Business meaning",
    });
  });

  it("rejeita edição concorrente do mesmo contexto de tabela", async () => {
    const expectedUpdatedAt = "2026-09-28T12:00:00.000Z";
    const database = new FakeDataSourceContextDatabase(
      new Date(expectedUpdatedAt),
    );
    await expect(
      updateTableContextIfSourceVersionMatches(
        database,
        "source-id",
        "table-id",
        "Stale context",
        expectedUpdatedAt,
        2,
      ),
    ).rejects.toBeInstanceOf(DataSourceTableContextVersionConflictError);
    expect(database.calls).toEqual(["lock-source", "update-table-context"]);
  });
});

describe("revisão do escopo de contexto do servidor", () => {
  const source = {
    name: "Analytics",
    host: "db.internal",
    port: 5432,
    databaseName: "analytics",
    username: "reader",
    context: "Orders are transactions",
  };

  it("invalida propostas se mudar texto, endpoint, nome de usuário ou credencial", () => {
    expect(
      sourceContextRevisionChanged(
        source,
        { ...source, context: "Other meaning" },
        false,
      ),
    ).toBe(true);
    expect(
      sourceContextRevisionChanged(
        source,
        { ...source, host: "db-v2.internal" },
        false,
      ),
    ).toBe(true);
    expect(
      sourceContextRevisionChanged(source, { ...source, port: 5433 }, false),
    ).toBe(true);
    expect(
      sourceContextRevisionChanged(
        source,
        { ...source, databaseName: "analytics_v2" },
        false,
      ),
    ).toBe(true);
    expect(
      sourceContextRevisionChanged(
        source,
        { ...source, username: "reader_v2" },
        false,
      ),
    ).toBe(true);
    expect(sourceContextRevisionChanged(source, source, true)).toBe(true);
  });

  it("mantém a revisão se o escopo e contexto continuam iguais", () => {
    expect(sourceContextRevisionChanged(source, { ...source }, false)).toBe(
      false,
    );
  });
});
