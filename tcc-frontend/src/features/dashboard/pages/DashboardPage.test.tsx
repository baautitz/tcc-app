import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Dashboard } from "@/types";
import { CurrentViewRefreshProvider } from "@/shared/context/CurrentViewRefreshContext";
import { DashboardPage } from "./DashboardPage";

const pending: Array<{ id: string; resolve: (v: unknown) => void }> = [];
const dashboard = {
  id: "d1",
  name: "Painel",
  description: "",
  definition: {
    layout: { columns: 12, gap: 16 },
    workspace: { params: [] },
    queryBindings: [],
    components: [
      { id: "a", type: "stat_card", title: "CardA", queryUuid: "qa", layoutProps: { colSpan: 6, rowSpan: 1 }, props: { field: "v" } },
      { id: "b", type: "stat_card", title: "CardB", queryUuid: "qb", layoutProps: { colSpan: 6, rowSpan: 1 }, props: { field: "v" } },
    ],
  },
} as unknown as Dashboard;

vi.mock("@/api", () => ({
  api: {
    dashboard: vi.fn(() => Promise.resolve(dashboard)),
    query: vi.fn(
      (id: string) => new Promise((resolve) => pending.push({ id, resolve })),
    ),
  },
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { isAdmin: false } }) }));
vi.mock("../components/DashboardFilters", () => ({ DashboardFilters: () => null }));
vi.mock("../components/DashboardUsersDialog", () => ({ DashboardUsersDialog: () => null }));

const flush = () => act(async () => { await Promise.resolve(); });
const rowsOf = (v: string) => ({ rows: [{ v }] });

describe("DashboardPage", () => {
  beforeEach(() => { pending.length = 0; });

  it("carrega uma query por componente", async () => {
    render(<CurrentViewRefreshProvider><DashboardPage dashboardId="d1" onEditContext={() => {}} /></CurrentViewRefreshProvider>);
    await screen.findByText("Painel");
    expect(pending.map((p) => p.id).sort()).toEqual(["qa", "qb"]);
    await act(async () => pending.forEach((p) => p.resolve(rowsOf(`val-${p.id}`))));
    expect(screen.getByText("val-qa")).toBeTruthy();
    expect(screen.getByText("val-qb")).toBeTruthy();
  });

  it("descarta resposta obsoleta resolvida fora de ordem", async () => {
    render(<CurrentViewRefreshProvider><DashboardPage dashboardId="d1" onEditContext={() => {}} /></CurrentViewRefreshProvider>);
    await screen.findByText("Painel");
    const first = [...pending];
    pending.length = 0;
    fireEvent.click(screen.getByLabelText("Atualizar dashboard"));
    await flush();
    const second = [...pending];
    expect(second.length).toBe(2);
    // nova rodada responde primeiro; a antiga chega depois e deve ser ignorada
    await act(async () => second.forEach((p) => p.resolve(rowsOf(`novo-${p.id}`))));
    await act(async () => first.forEach((p) => p.resolve(rowsOf(`velho-${p.id}`))));
    expect(screen.getByText("novo-qa")).toBeTruthy();
    expect(screen.queryByText("velho-qa")).toBeNull();
    expect(screen.queryByText("velho-qb")).toBeNull();
  });
});

afterEach(cleanup);
