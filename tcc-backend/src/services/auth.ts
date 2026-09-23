import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { permissions, sessions, userPermissions, users } from "../db/schema.js";
import { getEnvironment } from "../config.js";

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  permissions: string[];
}

export const SESSION_COOKIE = "tcc_session";

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const environment = getEnvironment();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + environment.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ userId, tokenHash: hashSessionToken(token), expiresAt });
  return { token, expiresAt };
}

export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.tokenHash, hashSessionToken(token)), isNull(sessions.revokedAt)));
}

export async function findAuthenticatedUser(token: string | undefined): Promise<AuthenticatedUser | null> {
  if (!token) return null;
  const session = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(
      eq(sessions.tokenHash, hashSessionToken(token)),
      isNull(sessions.revokedAt),
      gt(sessions.expiresAt, new Date()),
      eq(users.active, true),
    ))
    .limit(1);
  const row = session[0];
  if (!row) return null;
  const permissionRows = await db
    .select({ key: permissions.key })
    .from(userPermissions)
    .innerJoin(permissions, eq(userPermissions.permissionId, permissions.id))
    .where(eq(userPermissions.userId, row.user.id));
  return {
    id: row.user.id,
    name: row.user.name,
    email: row.user.email,
    isAdmin: row.user.isAdmin,
    permissions: permissionRows.map((permission) => permission.key),
  };
}

export function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.isAdmin || user.permissions.includes(key);
}
