import { and, eq, inArray, like, notInArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { permissions, userPermissions } from "../db/schema.js";
import { getPersistedRecipes } from "./recipes.js";

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
  ["dashboards:read", "Administrar dashboards"],
  ["dashboards:create", "Criar dashboards"],
  ["dashboards:update", "Editar dashboards"],
  ["dashboards:delete", "Excluir dashboards"],
  ["queries:read", "Administrar queries"],
  ["queries:create", "Criar queries"],
  ["queries:update", "Editar queries"],
  ["queries:delete", "Excluir queries"],
] as const;

type PermissionDefinition = { key: string; name: string; description?: string };

async function recipePermissions(): Promise<PermissionDefinition[]> {
  const recipes = await getPersistedRecipes();
  const found = new Map<string, PermissionDefinition>();

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.permission === "string") {
      found.set(record.permission, {
        key: record.permission,
        name: `Recipe: ${record.permission}`,
        description: "Permissão declarada pela recipe de dashboard.",
      });
    }
    Object.values(record).forEach(visit);
  };

  recipes.forEach(visit);
  return [...found.values()];
}

export async function ensureSystemPermissions(): Promise<void> {
  const recipeDefinitions = await recipePermissions();
  const definitions: PermissionDefinition[] = [
    ...API_PERMISSIONS.map(([key, name]) => ({ key, name })),
    ...recipeDefinitions,
  ];
  const keys = definitions.map((permission) => permission.key);

  // Resource permissions from old versions are not system permissions.
  await db.update(permissions).set({ system: false }).where(
    and(eq(permissions.system, true), like(permissions.key, "query:%")),
  );
  await db.update(permissions).set({ system: false }).where(
    and(eq(permissions.system, true), like(permissions.key, "dashboard:%")),
  );

  for (const definition of definitions) {
    await db.insert(permissions).values({ ...definition, system: true }).onConflictDoUpdate({
      target: permissions.key,
      set: { name: definition.name, description: definition.description ?? null, system: true },
    });
  }

  await db.delete(permissions).where(and(eq(permissions.system, true), notInArray(permissions.key, keys)));
}

export async function createResourcePermission(key: string, name: string, description: string): Promise<void> {
  await db.insert(permissions).values({ key, name, description, system: false }).onConflictDoUpdate({
    target: permissions.key,
    set: { name, description, system: false },
  });
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
