

import { dashboardAccessRepository } from "../infrastructure/dashboard-access-repository.js";
import { savedQueriesRepository } from "../../queries/infrastructure/saved-queries-repository.js";

import type { AuthenticatedUser } from "../../identity/domain/auth-user.js";

import { getRegisteredDashboards } from "./dashboard-registry.js";
import { dashboardQueryReferences } from "./dashboard-sync.js";
import { canAccessDashboard } from "../domain/dashboard-access.js";

import { ApiError } from "../../../shared/lib/domain-error.js";

export async function getAccessibleDashboards(currentUser: AuthenticatedUser) {
  const registered = await getRegisteredDashboards();
  if (currentUser.isAdmin) return registered;
  const assignments = await dashboardAccessRepository.listAssignedDashboardIds(currentUser.id);
  const assignedIds = new Set(assignments.map((assignment) => assignment.dashboardId));
  return registered.filter((dashboard) => canAccessDashboard(currentUser, dashboard.id, assignedIds));
}

export async function assertDashboardAccess(currentUser: AuthenticatedUser, dashboardId: string): Promise<void> {
  if (currentUser.isAdmin) return;
  const assignment = await dashboardAccessRepository.findAssignment(dashboardId, currentUser.id);
  if (!canAccessDashboard(currentUser, dashboardId, new Set(assignment ? [assignment.dashboardId] : []))) {
    throw new ApiError(403, "O usuário não possui acesso a este dashboard.");
  }
}

export async function accessibleQueryIds(currentUser: AuthenticatedUser): Promise<Set<string>> {
  if (currentUser.isAdmin) {
    const rows = await savedQueriesRepository.listAllIds();
    return new Set(rows.map((row) => row.id));
  }
  const dashboardsForUser = await getAccessibleDashboards(currentUser);
  return new Set(dashboardsForUser.flatMap((dashboard) => [...dashboardQueryReferences(dashboard)]));
}
