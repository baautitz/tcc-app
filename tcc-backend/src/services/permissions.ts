import {
  drizzlePermissionsRepository,
  type PermissionsRepository,
} from "../repositories/permissions-repository.js";

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

export async function ensureSystemPermissions(
  repo: PermissionsRepository = drizzlePermissionsRepository,
): Promise<void> {
  const definitions: PermissionDefinition[] = API_PERMISSIONS.map(
    ([key, name]) => ({ key, name }),
  );
  for (const definition of definitions) await repo.upsertSystemPermission(definition);
  await repo.deleteSystemPermissionsNotIn(definitions.map((permission) => permission.key));
}

export async function assignPermissionKeys(
  userId: string,
  keys: string[],
  repo: PermissionsRepository = drizzlePermissionsRepository,
): Promise<void> {
  const ids = await repo.findPermissionIdsByKeys(keys);
  if (ids.length !== keys.length) {
    throw new Error("Uma ou mais permissões informadas não existem.");
  }
  await repo.replaceUserPermissions(userId, ids);
}
