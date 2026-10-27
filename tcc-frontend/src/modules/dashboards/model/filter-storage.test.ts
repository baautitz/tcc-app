import { beforeEach, describe, expect, it } from "vitest";
import { loadDashboardFilters, saveDashboardFilters } from "./filter-storage";

describe("filtros salvos por dashboard", () => {
  beforeEach(() => localStorage.clear());

  it("restaura o que foi salvo para o mesmo dashboard", () => {
    saveDashboardFilters("d1", { start: "2026-01-01", tags: ["a", "b"] });
    expect(loadDashboardFilters("d1")).toEqual({
      start: "2026-01-01",
      tags: ["a", "b"],
    });
  });

  it("não mistura filtros de dashboards diferentes", () => {
    saveDashboardFilters("d1", { start: "2026-01-01" });
    expect(loadDashboardFilters("d2")).toEqual({});
  });

  it("ignora conteúdo inválido ou corrompido", () => {
    localStorage.setItem("dashboard-filters:d1", "{quebrado");
    expect(loadDashboardFilters("d1")).toEqual({});
    localStorage.setItem("dashboard-filters:d1", JSON.stringify({ a: 1 }));
    expect(loadDashboardFilters("d1")).toEqual({});
  });
});
