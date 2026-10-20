import { describe, expect, it, vi } from "vitest";
import { DataSourceAdminService } from "./data-source-admin.js";
import type { DataSourcesRepository } from "../infrastructure/data-sources-repository.js";

function fakeRepo(
  overrides: Partial<DataSourcesRepository> = {},
): DataSourcesRepository {
  return {
    listAll: vi.fn(async () => []),
    findById: vi.fn(async () => undefined),
    listTables: vi.fn(async () => []),
    tableExists: vi.fn(async () => false),
    insert: vi.fn(),
    deleteWithQueries: vi.fn(async () => []),
    catalogTransaction: vi.fn(),
    contextTransaction: vi.fn(),
    ...overrides,
  } as unknown as DataSourcesRepository;
}

const key = Buffer.alloc(32, 1).toString("base64");
const make = (repo: DataSourcesRepository) =>
  new DataSourceAdminService(repo, vi.fn(), key);

describe("DataSourceAdminService", () => {
  it("getSourceOrThrow responde 404 quando nao existe", async () => {
    await expect(make(fakeRepo()).getSourceOrThrow("x")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("deleteSource responde 404 quando nada foi removido", async () => {
    const repo = fakeRepo({
      findById: vi.fn(async () => ({ id: "x" })) as never,
    });
    await expect(make(repo).deleteSource("x")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("listSources nao expoe a senha criptografada", async () => {
    const repo = fakeRepo({
      listAll: vi.fn(async () => [
        { id: "x", encryptedPassword: "s" },
      ]) as never,
    });
    expect(await make(repo).listSources()).toEqual([{ id: "x" }]);
  });
});
