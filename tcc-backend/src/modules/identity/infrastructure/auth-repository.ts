import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../../../shared/db/client.js";
import { permissions, sessions, userPermissions, users } from "../../../shared/db/schema.js";

export type AuthUserRow = typeof users.$inferSelect;

export interface AuthRepository {
  insertSession(values: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  revokeSessionByHash(tokenHash: string): Promise<void>;
  findActiveUserByTokenHash(tokenHash: string): Promise<AuthUserRow | undefined>;
  listPermissionKeys(userId: string): Promise<string[]>;
}

export class DrizzleAuthRepository implements AuthRepository {
  async insertSession(values: { userId: string; tokenHash: string; expiresAt: Date }) {
    await db.insert(sessions).values(values);
  }
  async revokeSessionByHash(tokenHash: string) {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
  }
  async findActiveUserByTokenHash(tokenHash: string) {
    const rows = await db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          eq(users.active, true),
        ),
      )
      .limit(1);
    return rows[0]?.user;
  }
  async listPermissionKeys(userId: string) {
    const rows = await db
      .select({ key: permissions.key })
      .from(userPermissions)
      .innerJoin(permissions, eq(userPermissions.permissionId, permissions.id))
      .where(eq(userPermissions.userId, userId));
    return rows.map((row) => row.key);
  }
}
