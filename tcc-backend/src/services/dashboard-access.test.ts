import { describe, expect, it } from "vitest";
import { canAccessDashboard, canExecuteQuery } from "./dashboard-access.js";

describe("acesso a dashboards e queries", () => {
  it("permite abrir somente dashboards associados ao usuário", () => {
    const user = { id: "user-1", isAdmin: false };
    const assignedDashboardIds = new Set(["dashboard-1"]);

    expect(canAccessDashboard(user, "dashboard-1", assignedDashboardIds)).toBe(true);
    expect(canAccessDashboard(user, "dashboard-2", assignedDashboardIds)).toBe(false);
    expect(canAccessDashboard(user, "dashboard-2", new Set())).toBe(false);
  });

  it("permite que administradores abram dashboards sem usuários associados", () => {
    expect(canAccessDashboard({ id: "admin", isAdmin: true }, "dashboard-1", new Set())).toBe(true);
  });

  it("permite executar queries referenciadas pelos dashboards acessíveis", () => {
    const user = { id: "user-1", isAdmin: false };
    const queryIds = new Set(["query-1"]);

    expect(canExecuteQuery(user, "query-1", queryIds)).toBe(true);
    expect(canExecuteQuery(user, "query-2", queryIds)).toBe(false);
  });

  it("permite administradores executar qualquer query", () => {
    expect(canExecuteQuery({ id: "admin", isAdmin: true }, "query-1", new Set())).toBe(true);
  });
});
