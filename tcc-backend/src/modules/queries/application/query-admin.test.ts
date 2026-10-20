import { describe, expect, it, vi } from "vitest";
import { QueryService } from "./query-admin.js";
import type { SavedQueriesRepository } from "../infrastructure/saved-queries-repository.js";
import type { QueryLifecycleRepository } from "../domain/query-lifecycle.js";

function fakeRepo(
  overrides: Partial<SavedQueriesRepository> = {},
): SavedQueriesRepository {
  return {
    listSummaries: vi.fn(async () => []),
    findById: vi.fn(async () => undefined),
    listAllIds: vi.fn(),
    listParametersByIds: vi.fn(),
    listWithSourcesByIds: vi.fn(),
    lockNameById: vi.fn(),
    deleteById: vi.fn(),
    findReceipt: vi.fn(),
    ...overrides,
  } as SavedQueriesRepository;
}

const lifecycle = { transaction: vi.fn() } as QueryLifecycleRepository;
const user = (permissions: string[]) => ({
  id: "u1",
  name: "A",
  email: "a@x.com",
  isAdmin: false,
  permissions,
});

describe("QueryService", () => {
  it("404 quando a query nao existe", async () => {
    const service = new QueryService(fakeRepo(), lifecycle);
    await expect(service.getQueryOrThrow("q1")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("previa exige create ou update", () => {
    const service = new QueryService(fakeRepo(), lifecycle);
    expect(() => service.assertCanPreview(user([]))).toThrowError(
      expect.objectContaining({ status: 403 }),
    );
    expect(() =>
      service.assertCanPreview(user(["queries:update"])),
    ).not.toThrow();
  });

  it("rejeita SQL que nao e somente leitura", () => {
    const service = new QueryService(fakeRepo(), lifecycle);
    expect(() =>
      service.validateQueryInput({
        dataSourceId: "d",
        sqlText: "DELETE FROM t",
        parameters: [],
      }),
    ).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it("excluir sem porta de dashboards configurada falha", async () => {
    const service = new QueryService(fakeRepo(), lifecycle);
    await expect(service.deleteQueryWithDashboards("q1")).rejects.toThrow(
      "DashboardFilesPort",
    );
  });
});
