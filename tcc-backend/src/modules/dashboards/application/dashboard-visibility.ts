import {
  DrizzleDashboardAccessRepository,
  type DashboardAccessRepository,
} from "../infrastructure/dashboard-access-repository.js";
import { savedQueriesPort } from "../../queries/application/saved-queries.js";
import type { SavedQueriesPort } from "../../queries/domain/saved-queries-port.js";

import type { AuthenticatedUser } from "../../identity/domain/auth-user.js";

import {
  dashboardRegistry,
  type DashboardRegistryService,
} from "./dashboard-registry.js";
import {
  buildDashboardDefinitionFromDocument,
  dashboardQueryReferences,
} from "./dashboard-sync.js";
import { canAccessDashboard } from "../domain/dashboard-access.js";

import { ApiError } from "../../../shared/lib/domain-error.js";

export class DashboardVisibilityService {
  constructor(
    private readonly access: DashboardAccessRepository,
    private readonly registry: Pick<
      DashboardRegistryService,
      "getRegisteredDashboards"
    >,
    private readonly savedQueries: () => Pick<
      SavedQueriesPort,
      "listAllIds" | "listParametersByIds"
    >,
  ) {}

  async getAccessibleDashboards(currentUser: AuthenticatedUser) {
    const registered = await this.registry.getRegisteredDashboards();
    if (currentUser.isAdmin) return registered;
    const assignments = await this.access.listAssignedDashboardIds(
      currentUser.id,
    );
    const assignedIds = new Set(
      assignments.map((assignment) => assignment.dashboardId),
    );
    return registered.filter((dashboard) =>
      canAccessDashboard(currentUser, dashboard.id, assignedIds),
    );
  }

  async assertDashboardAccess(
    currentUser: AuthenticatedUser,
    dashboardId: string,
  ): Promise<void> {
    if (currentUser.isAdmin) return;
    const assignment = await this.access.findAssignment(
      dashboardId,
      currentUser.id,
    );
    if (
      !canAccessDashboard(
        currentUser,
        dashboardId,
        new Set(assignment ? [assignment.dashboardId] : []),
      )
    ) {
      throw new ApiError(403, "O usuário não possui acesso a este dashboard.");
    }
  }

  async listDashboards(currentUser: AuthenticatedUser) {
    const accessibleDashboards =
      await this.getAccessibleDashboards(currentUser);
    return accessibleDashboards.map((dashboard) => ({
      id: dashboard.id,
      name: dashboard.name,
      description: dashboard.description ?? null,
    }));
  }

  async getDashboardView(currentUser: AuthenticatedUser, dashboardId: string) {
    const dashboard = (await this.registry.getRegisteredDashboards()).find(
      (item) => item.id === dashboardId,
    );
    if (!dashboard) throw new ApiError(404, "Dashboard não encontrado.");
    await this.assertDashboardAccess(currentUser, dashboardId);
    const queryIds = [...dashboardQueryReferences(dashboard)];
    const catalogQueries = queryIds.length
      ? await this.savedQueries().listParametersByIds(queryIds)
      : [];
    let definition;
    try {
      definition = buildDashboardDefinitionFromDocument(
        dashboard,
        catalogQueries,
        { validateCatalog: false },
      );
    } catch (error) {
      throw new ApiError(
        400,
        error instanceof Error
          ? error.message
          : "O dashboard possui referências inválidas.",
      );
    }
    return {
      id: dashboard.id,
      name: dashboard.name,
      description: dashboard.description ?? null,
      definition,
    };
  }

  async accessibleQueryIds(
    currentUser: AuthenticatedUser,
  ): Promise<Set<string>> {
    if (currentUser.isAdmin) {
      const rows = await this.savedQueries().listAllIds();
      return new Set(rows.map((row) => row.id));
    }
    const dashboardsForUser = await this.getAccessibleDashboards(currentUser);
    return new Set(
      dashboardsForUser.flatMap((dashboard) => [
        ...dashboardQueryReferences(dashboard),
      ]),
    );
  }
}

export const dashboardVisibilityService = new DashboardVisibilityService(
  new DrizzleDashboardAccessRepository(),
  dashboardRegistry,
  savedQueriesPort,
);
