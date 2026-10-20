import {
  DrizzlePermissionsRepository,
  type PermissionsRepository,
} from "../infrastructure/permissions-repository.js";

const API_PERMISSIONS = [
  ["users:read", "Ler usuários"],
  ["users:create", "Criar usuários"],
  ["users:update", "Editar usuários"],
  ["users:delete", "Excluir usuários"],
  ["permissions:read", "Ler permissões"],
  ["permissions:create", "Criar permissões"],
  ["permissions:update", "Editar permissões"],
  ["permissions:delete", "Excluir permissões"],
  ["data-sources:read", "Ler servidores"],
  ["data-sources:create", "Cadastrar servidores"],
  ["data-sources:update", "Editar servidores"],
  ["data-sources:delete", "Excluir servidores"],
  ["queries:read", "Administrar queries"],
  ["queries:create", "Criar queries"],
  ["queries:update", "Editar queries"],
  ["queries:delete", "Excluir queries"],
] as const;

type PermissionDefinition = { key: string; name: string; description?: string };

export class PermissionService {
  constructor(private readonly repo: PermissionsRepository) {}

  async ensureSystemPermissions(): Promise<void> {
    const definitions: PermissionDefinition[] = API_PERMISSIONS.map(
      ([key, name]) => ({ key, name }),
    );
    for (const definition of definitions)
      await this.repo.upsertSystemPermission(definition);
    await this.repo.deleteSystemPermissionsNotIn(
      definitions.map((permission) => permission.key),
    );
  }

  async assignPermissionKeys(userId: string, keys: string[]): Promise<void> {
    const ids = await this.repo.findPermissionIdsByKeys(keys);
    if (ids.length !== keys.length) {
      throw new Error("Uma ou mais permissões informadas não existem.");
    }
    await this.repo.replaceUserPermissions(userId, ids);
  }
}

export const permissionService = new PermissionService(
  new DrizzlePermissionsRepository(),
);
