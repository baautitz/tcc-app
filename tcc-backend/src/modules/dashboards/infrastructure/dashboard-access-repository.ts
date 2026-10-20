import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../../shared/db/client.js";
import { dashboardUsers, users } from "../../../shared/db/schema.js";

export const dashboardAccessRepository = {
  async listAssignedDashboardIds(userId: string) {
    return db
      .select({ dashboardId: dashboardUsers.dashboardId })
      .from(dashboardUsers)
      .where(eq(dashboardUsers.userId, userId));
  },
  async findAssignment(dashboardId: string, userId: string) {
    return (
      await db
        .select({ dashboardId: dashboardUsers.dashboardId })
        .from(dashboardUsers)
        .where(
          and(
            eq(dashboardUsers.dashboardId, dashboardId),
            eq(dashboardUsers.userId, userId),
          ),
        )
        .limit(1)
    )[0];
  },
  async listAssignedUserIds(dashboardId: string) {
    return db
      .select({ userId: dashboardUsers.userId })
      .from(dashboardUsers)
      .where(eq(dashboardUsers.dashboardId, dashboardId));
  },
  async listAssignableUsers() {
    return db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        active: users.active,
      })
      .from(users)
      .orderBy(asc(users.name));
  },
  async findKnownUserIds(ids: string[]) {
    return ids.length === 0
      ? []
      : db.select({ id: users.id }).from(users).where(inArray(users.id, ids));
  },
  async replaceUsers(dashboardId: string, userIds: string[]) {
    await db.transaction(async (tx) => {
      await tx
        .delete(dashboardUsers)
        .where(eq(dashboardUsers.dashboardId, dashboardId));
      if (userIds.length > 0) {
        await tx
          .insert(dashboardUsers)
          .values(userIds.map((userId) => ({ dashboardId, userId })));
      }
    });
  },
};
