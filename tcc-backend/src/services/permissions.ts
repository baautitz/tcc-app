import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { permissions, userPermissions } from "../db/schema.js";

export const SYSTEM_PERMISSIONS = [
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
  ["dashboards:read", "Administrar dashboards"],
  ["dashboards:create", "Criar dashboards"],
  ["dashboards:update", "Editar dashboards"],
  ["dashboards:delete", "Excluir dashboards"],
  ["queries:read", "Administrar queries"],
  ["queries:create", "Criar queries"],
  ["queries:update", "Editar queries"],
  ["queries:delete", "Excluir queries"],
] as const;

export async function ensureSystemPermissions(): Promise<void> {
  for (const [key, name] of SYSTEM_PERMISSIONS) {
    await db.insert(permissions).values({ key, name, system: true }).onConflictDoNothing();
  }
}

export async function createResourcePermission(key: string, name: string, description: string): Promise<void> {
  await db.insert(permissions).values({ key, name, description, system: true }).onConflictDoNothing();
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

export async function grantPermissionKeys(userId: string, keys: string[]): Promise<void> {
  const rows = keys.length === 0 ? [] : await db.select({ id: permissions.id }).from(permissions).where(inArray(permissions.key, keys));
  if (rows.length !== keys.length) {
    throw new Error("Não foi possível conceder uma permissão de recurso.");
  }
  if (rows.length > 0) {
    await db.insert(userPermissions).values(rows.map((permission) => ({ userId, permissionId: permission.id }))).onConflictDoNothing();
  }
}
