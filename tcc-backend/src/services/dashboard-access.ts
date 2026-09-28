type UserAccess = { id: string; isAdmin: boolean };

export function canAccessDashboard(
  user: UserAccess,
  dashboardId: string,
  assignedDashboardIds: ReadonlySet<string>,
): boolean {
  return user.isAdmin || assignedDashboardIds.has(dashboardId);
}

export function canExecuteQuery(
  user: UserAccess,
  queryId: string,
  referencedByAccessibleDashboard: ReadonlySet<string>,
): boolean {
  return user.isAdmin || referencedByAccessibleDashboard.has(queryId);
}
