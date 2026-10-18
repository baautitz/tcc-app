import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../shared/db/client.js";
import { permissions, userPermissions, users } from "../shared/db/schema.js";

export const usersRepository = {
  async findByEmail(email: string) {
    return (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  },
  async listAll() {
    return db.select({ user: users }).from(users).orderBy(asc(users.name));
  },
  async listPermissionAssignments() {
    return db.select({ userId: userPermissions.userId, key: permissions.key })
      .from(userPermissions)
      .innerJoin(permissions, eq(userPermissions.permissionId, permissions.id));
  },
  async findKnownPermissionKeys(keys: string[]) {
    return db.select({ key: permissions.key }).from(permissions).where(inArray(permissions.key, keys));
  },
  async insert(values: typeof users.$inferInsert) {
    return (await db.insert(users).values(values).returning())[0];
  },
  async update(userId: string, update: Partial<typeof users.$inferInsert>) {
    return (await db.update(users).set(update).where(eq(users.id, userId)).returning())[0];
  },
  async delete(userId: string) {
    return db.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
  },
  async listSystemPermissions() {
    return db.select().from(permissions).where(eq(permissions.system, true)).orderBy(asc(permissions.key));
  },
};
