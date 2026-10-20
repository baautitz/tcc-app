import { describe, expect, it, vi } from "vitest";
import { AuthService } from "./auth.js";
import type { AuthRepository } from "../infrastructure/auth-repository.js";

function fakeRepo(): AuthRepository {
  return {
    insertSession: vi.fn(async () => {}),
    revokeSessionByHash: vi.fn(async () => {}),
    findActiveUserByTokenHash: vi.fn(async () => undefined),
    listPermissionKeys: vi.fn(async () => []),
  };
}

describe("AuthService", () => {
  it("createSession gera hash e expiracao com clock injetado", async () => {
    const repo = fakeRepo();
    const service = new AuthService(repo, () => ({ SESSION_TTL_DAYS: 2 }), () => 1_000);
    const { token, expiresAt } = await service.createSession("u1");
    expect(expiresAt.getTime()).toBe(1_000 + 2 * 86_400_000);
    const arg = vi.mocked(repo.insertSession).mock.calls[0]![0];
    expect(arg.userId).toBe("u1");
    expect(arg.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(arg.tokenHash).not.toBe(token);
  });

  it("findAuthenticatedUser retorna null sem token", async () => {
    const repo = fakeRepo();
    const service = new AuthService(repo, () => ({ SESSION_TTL_DAYS: 1 }));
    expect(await service.findAuthenticatedUser(undefined)).toBeNull();
    expect(repo.findActiveUserByTokenHash).not.toHaveBeenCalled();
  });

  it("importar o modulo nao le o ambiente ate createSession", async () => {
    const saved = { ...process.env };
    delete process.env.DATABASE_URL;
    vi.resetModules();
    vi.doMock("../../../shared/db/client.js", () => ({ db: {} }));
    try {
      const mod = await import("./auth.js");
      expect(mod.authService).toBeDefined();
      await expect(mod.authService.createSession("u")).rejects.toThrow();
    } finally {
      process.env = saved;
    }
  });
});
