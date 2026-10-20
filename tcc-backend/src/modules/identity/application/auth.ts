import { randomBytes } from "node:crypto";
import { sha256Hex } from "../../../shared/lib/hash.js";
import { DrizzleAuthRepository, type AuthRepository } from "../infrastructure/auth-repository.js";
import { getEnvironment } from "../../../shared/config/config.js";
import type { AuthenticatedUser } from "../domain/auth-user.js";

export const SESSION_COOKIE = "tcc_session";

export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly environment: { SESSION_TTL_DAYS: number },
    private readonly now: () => number = Date.now,
  ) {}

  private static hashToken(token: string): string {
    return sha256Hex(token);
  }

  async createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      this.now() + this.environment.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.repo.insertSession({ userId, tokenHash: AuthService.hashToken(token), expiresAt });
    return { token, expiresAt };
  }

  async revokeSession(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.repo.revokeSessionByHash(AuthService.hashToken(token));
  }

  async findAuthenticatedUser(token: string | undefined): Promise<AuthenticatedUser | null> {
    if (!token) return null;
    const user = await this.repo.findActiveUserByTokenHash(AuthService.hashToken(token));
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
      permissions: await this.repo.listPermissionKeys(user.id),
    };
  }
}

export const authService = new AuthService(new DrizzleAuthRepository(), getEnvironment());
