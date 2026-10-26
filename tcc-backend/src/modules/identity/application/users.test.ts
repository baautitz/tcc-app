import { describe, expect, it, vi } from "vitest";
import { UserService } from "./users.js";
import type { UsersRepository } from "../infrastructure/users-repository.js";

function fakeRepo(overrides: Partial<UsersRepository> = {}): UsersRepository {
  return {
    findByEmail: vi.fn(),
    listAll: vi.fn(async () => []),
    listPermissionAssignments: vi.fn(async () => []),
    findKnownPermissionKeys: vi.fn(async () => []),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(async () => [{ id: "x" }]),
    listSystemPermissions: vi.fn(async () => []),
    ...overrides,
  } as UsersRepository;
}

describe("UserService", () => {
  const permissions = { assignPermissionKeys: vi.fn(async () => {}) };

  it("rejeita chave de permissao desconhecida", async () => {
    const repo = fakeRepo();
    const service = new UserService(repo, permissions);
    await expect(
      service.createUser({
        name: "Ana",
        email: "A@x.com",
        password: "Senha#12345",
        permissionKeys: ["nope:x"],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("devolve 409 quando o e-mail ja esta cadastrado", async () => {
    const repo = fakeRepo({
      findByEmail: vi.fn(async () => ({ id: "u9" })),
    } as unknown as Partial<UsersRepository>);
    const service = new UserService(repo, permissions);
    await expect(
      service.createUser({
        name: "Ana",
        email: "A@x.com",
        password: "Senha#12345",
        permissionKeys: [],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(repo.findByEmail).toHaveBeenCalledWith("a@x.com");
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("devolve 409 quando o insert viola unicidade (23505)", async () => {
    const repo = fakeRepo({
      findByEmail: vi.fn(async () => undefined),
      insert: vi.fn(async () => {
        throw Object.assign(new Error("dup"), { code: "23505" });
      }),
    } as unknown as Partial<UsersRepository>);
    const service = new UserService(repo, permissions);
    await expect(
      service.createUser({
        name: "Ana",
        email: "a@x.com",
        password: "Senha#12345",
        permissionKeys: [],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("repropaga erros de insert que nao sao de unicidade", async () => {
    const repo = fakeRepo({
      findByEmail: vi.fn(async () => undefined),
      insert: vi.fn(async () => {
        throw new Error("boom");
      }),
    } as unknown as Partial<UsersRepository>);
    const service = new UserService(repo, permissions);
    await expect(
      service.createUser({
        name: "Ana",
        email: "a@x.com",
        password: "Senha#12345",
        permissionKeys: [],
      }),
    ).rejects.toThrow("boom");
  });

  it("nao deixa excluir a si mesmo", async () => {
    const repo = fakeRepo();
    const service = new UserService(repo, permissions);
    await expect(service.deleteUser("u1", "u1")).rejects.toMatchObject({
      status: 400,
    });
    expect(repo.delete).not.toHaveBeenCalled();
  });
});
