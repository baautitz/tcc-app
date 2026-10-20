import { ApiError } from "../../../shared/lib/domain-error.js";
import { hashPassword } from "../../../shared/lib/passwords.js";
import type { users } from "../../../shared/db/schema.js";
import {
  DrizzleUsersRepository,
  type UsersRepository,
} from "../infrastructure/users-repository.js";
import { permissionService, type PermissionService } from "./permissions.js";

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  permissionKeys: string[];
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  password?: string;
  active?: boolean;
  permissionKeys?: string[];
}

export class UserService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly permissions: Pick<
      PermissionService,
      "assignPermissionKeys"
    >,
  ) {}

  async listUsers() {
    const rows = await this.repo.listAll();
    const assignments = await this.repo.listPermissionAssignments();
    return rows.map(({ user }) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
      active: user.active,
      createdAt: user.createdAt,
      permissions: assignments
        .filter((assignment) => assignment.userId === user.id)
        .map((assignment) => assignment.key),
    }));
  }

  async createUser(input: CreateUserInput): Promise<{ id: string }> {
    await this.assertKnownPermissionKeys(input.permissionKeys);
    const user = await this.repo.insert({
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash: hashPassword(input.password),
    });
    if (!user) throw new ApiError(500, "Não foi possível criar o usuário.");
    await this.permissions.assignPermissionKeys(user.id, input.permissionKeys);
    return { id: user.id };
  }

  async updateUser(
    userId: string,
    input: UpdateUserInput,
  ): Promise<{ id: string }> {
    if (input.permissionKeys)
      await this.assertKnownPermissionKeys(input.permissionKeys);
    const update: Partial<typeof users.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (input.name !== undefined) update.name = input.name;
    if (input.email !== undefined) update.email = input.email.toLowerCase();
    if (input.active !== undefined) update.active = input.active;
    if (input.password !== undefined)
      update.passwordHash = hashPassword(input.password);
    const user = await this.repo.update(userId, update);
    if (!user) throw new ApiError(404, "Usuário não encontrado.");
    if (input.permissionKeys)
      await this.permissions.assignPermissionKeys(userId, input.permissionKeys);
    return { id: user.id };
  }

  async deleteUser(userId: string, currentUserId: string): Promise<void> {
    if (userId === currentUserId)
      throw new ApiError(400, "O usuário não pode excluir a própria conta.");
    const deleted = await this.repo.delete(userId);
    if (deleted.length === 0)
      throw new ApiError(404, "Usuário não encontrado.");
  }

  listSystemPermissions() {
    return this.repo.listSystemPermissions();
  }

  private async assertKnownPermissionKeys(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const known = await this.repo.findKnownPermissionKeys(keys);
    if (known.length !== keys.length)
      throw new ApiError(
        400,
        "Uma ou mais permissões não existem no catálogo.",
      );
  }
}

export const userService = new UserService(
  new DrizzleUsersRepository(),
  permissionService,
);
