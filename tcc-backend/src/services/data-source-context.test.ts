import { describe, expect, it } from "vitest";
import {
  DataSourceContextVersionConflictError,
  updateTableContextIfSourceVersionMatches,
  type DataSourceContextDatabase,
  type DataSourceContextTransaction,
} from "./data-source-context.js";

class FakeDataSourceContextDatabase implements DataSourceContextDatabase {
  calls: string[] = [];
  updatedContext: { dataSourceId: string; tableId: string; context: string } | undefined;

  constructor(public sourceUpdatedAt: Date | undefined) {}

  async transaction<T>(work: (tx: DataSourceContextTransaction) => Promise<T>): Promise<T> {
    const tx: DataSourceContextTransaction = {
      lockSourceUpdatedAt: async () => {
        this.calls.push("lock-source");
        return this.sourceUpdatedAt;
      },
      updateTableContext: async (dataSourceId, tableId, context) => {
        this.calls.push("update-table-context");
        this.updatedContext = { dataSourceId, tableId, context };
        return { id: tableId, dataSourceId, context };
      },
    };
    return work(tx);
  }
}

describe("edição manual do contexto de tabela", () => {
  it("valida a versão da fonte sob lock antes de escrever o contexto", async () => {
    const database = new FakeDataSourceContextDatabase(new Date("2026-09-28T12:00:01.000Z"));

    await expect(updateTableContextIfSourceVersionMatches(
      database,
      "source-id",
      "table-id",
      "New context",
      "2026-09-28T12:00:00.000Z",
    )).rejects.toBeInstanceOf(DataSourceContextVersionConflictError);

    expect(database.calls).toEqual(["lock-source"]);
    expect(database.updatedContext).toBeUndefined();
  });

  it("permite salvar normalmente quando a versão enviada ainda é atual", async () => {
    const expectedUpdatedAt = "2026-09-28T12:00:00.000Z";
    const database = new FakeDataSourceContextDatabase(new Date(expectedUpdatedAt));

    await expect(updateTableContextIfSourceVersionMatches(
      database,
      "source-id",
      "table-id",
      "Business meaning",
      expectedUpdatedAt,
    )).resolves.toEqual({ id: "table-id", dataSourceId: "source-id", context: "Business meaning" });

    expect(database.calls).toEqual(["lock-source", "update-table-context"]);
    expect(database.updatedContext).toEqual({
      dataSourceId: "source-id",
      tableId: "table-id",
      context: "Business meaning",
    });
  });
});
