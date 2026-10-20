import { describe, expect, it, vi } from "vitest";
import { DashboardVisibilityService } from "./dashboard-visibility.js";
import type { DashboardAccessRepository } from "../infrastructure/dashboard-access-repository.js";

const dashboard = (id: string) =>
  ({
    id,
    name: id,
    workspace: { params: [] },
    queryBindings: [{ queryUuid: `q-${id}` }],
    ui: { components: [] },
  }) as never;

function build(assigned: string[]) {
  const access = {
    listAssignedDashboardIds: vi.fn(async () =>
      assigned.map((dashboardId) => ({ dashboardId })),
    ),
    findAssignment: vi.fn(async (dashboardId: string) =>
      assigned.includes(dashboardId) ? { dashboardId } : undefined,
    ),
  } as unknown as DashboardAccessRepository;
  const registry = {
    getRegisteredDashboards: vi.fn(async () => [
      dashboard("a"),
      dashboard("b"),
    ]),
  };
  const queries = { listAllIds: vi.fn(async () => [{ id: "z" }]) };
  const service = new DashboardVisibilityService(
    access,
    registry,
    () => queries as never,
  );
  return { service };
}

const user = (isAdmin: boolean) =>
  ({ id: "u", isAdmin, permissions: [] }) as never;

describe("DashboardVisibilityService", () => {
  it("usuario comum so ve dashboards atribuidos", async () => {
    const { service } = build(["a"]);
    const list = await service.getAccessibleDashboards(user(false));
    expect(list.map((d) => d.id)).toEqual(["a"]);
    expect([...(await service.accessibleQueryIds(user(false)))]).toEqual([
      "q-a",
    ]);
  });

  it("nega acesso a dashboard nao atribuido", async () => {
    const { service } = build(["a"]);
    await expect(
      service.assertDashboardAccess(user(false), "b"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.assertDashboardAccess(user(true), "b"),
    ).resolves.toBeUndefined();
  });

  it("admin ve todas as queries", async () => {
    const { service } = build([]);
    expect([...(await service.accessibleQueryIds(user(true)))]).toEqual(["z"]);
  });
});
