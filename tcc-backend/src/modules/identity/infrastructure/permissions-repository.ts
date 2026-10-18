import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "../../../shared/db/client.js";
import { permissions, userPermissions } from "../../../shared/db/schema.js";

export interface PermissionsRepository {
  upsertSystemPermission(def: { key: string; name: string; description?: string }): Promise<void>;
  deleteSystemPermissionsNotIn(keys: string[]): Promise<void>;
  findPermissionIdsByKeys(keys: string[]): Promise<string[]>;
  replaceUserPermissions(userId: string, permissionIds: string[]): Promise<void>;
}

export const drizzlePermissionsRepository: PermissionsRepository = {
  async upsertSystemPermission(definition) {
    await db
      .insert(permissions)
      .values({ ...definition, system: true })
      .onConflictDoUpdate({
        target: permissions.key,
        set: {
          name: definition.name,
          description: definition.description ?? null,
          system: true,
        },
      });
  },
  async deleteSystemPermissionsNotIn(keys) {
    await db
      .delete(permissions)
      .where(and(eq(permissions.system, true), notInArray(permissions.key, keys)));
  },
  async findPermissionIdsByKeys(keys) {
    if (keys.length === 0) return [];
    const rows = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(inArray(permissions.key, keys));
    return rows.map((row) => row.id);
  },
  async replaceUserPermissions(userId, permissionIds) {
    await db.delete(userPermissions).where(eq(userPermissions.userId, userId));
    if (permissionIds.length > 0) {
      await db
        .insert(userPermissions)
        .values(permissionIds.map((permissionId) => ({ userId, permissionId })))
        .onConflictDoNothing();
    }
  },
};
