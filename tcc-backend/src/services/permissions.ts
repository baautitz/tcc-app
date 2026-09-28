import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { permissions, userPermissions } from "../db/schema.js";

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

export async function ensureSystemPermissions(): Promise<void> {
  const definitions: PermissionDefinition[] = API_PERMISSIONS.map(([key, name]) => ({ key, name }));
  const keys = definitions.map((permission) => permission.key);

  for (const definition of definitions) {
    await db.insert(permissions).values({ ...definition, system: true }).onConflictDoUpdate({
      target: permissions.key,
      set: { name: definition.name, description: definition.description ?? null, system: true },
    });
  }

  await db.delete(permissions).where(and(eq(permissions.system, true), notInArray(permissions.key, keys)));
}

export async function assignPermissionKeys(userId: string, keys: string[]): Promise<void> {
  const rows = keys.length === 0 ? [] : await db.select({ id: permissions.id }).from(permissions).where(inArray(permissions.key, keys));
  if (rows.length !== keys.length) {
    throw new Error("Uma ou mais permissões informadas não existem.");
  }
  await db.delete(userPermissions).where(eq(userPermissions.userId, userId));
  if (rows.length > 0) {
    await db.insert(userPermissions).values(rows.map((permission) => ({ userId, permissionId: permission.id }))).onConflictDoNothing();
  }
}
