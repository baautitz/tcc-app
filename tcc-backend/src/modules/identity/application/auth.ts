import { randomBytes } from "node:crypto";
import { sha256Hex } from "../../../shared/lib/hash.js";
import { drizzleAuthRepository, type AuthRepository } from "../infrastructure/auth-repository.js";
import { getEnvironment } from "../../../shared/config/config.js";
import type { AuthenticatedUser } from "../domain/auth-user.js";

export const SESSION_COOKIE = "tcc_session";

export function hashSessionToken(token: string): string {
  return sha256Hex(token);
}

export async function createSession(
  userId: string,
  repo: AuthRepository = drizzleAuthRepository,
  environment = getEnvironment(),
  now: () => number = Date.now,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    now() + environment.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  await repo.insertSession({ userId, tokenHash: hashSessionToken(token), expiresAt });
  return { token, expiresAt };
}

export async function revokeSession(
  token: string | undefined,
  repo: AuthRepository = drizzleAuthRepository,
): Promise<void> {
  if (!token) return;
  await repo.revokeSessionByHash(hashSessionToken(token));
}

export async function findAuthenticatedUser(
  token: string | undefined,
  repo: AuthRepository = drizzleAuthRepository,
): Promise<AuthenticatedUser | null> {
  if (!token) return null;
  const user = await repo.findActiveUserByTokenHash(hashSessionToken(token));
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isAdmin: user.isAdmin,
    permissions: await repo.listPermissionKeys(user.id),
  };
}
