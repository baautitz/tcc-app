

import { z } from "zod";
import { } from "../../../shared/config/config.js";
import { DrizzleUsersRepository } from "../infrastructure/users-repository.js";
import type { users } from "../../../shared/db/schema.js";
import {
  passwordSchema,
  permissionKeySchema,
  
  
  
  
  
  
  
  
  
  
  
} from "../../../shared/lib/contracts.js";

import { hashPassword } from "../../../shared/lib/passwords.js";

import { permissionService } from "../application/permissions.js";

import { ApiError } from "../../../shared/lib/domain-error.js";

import type { AppContext } from "../../../shared/middleware/auth.js";
import { jsonBody } from "../../../shared/middleware/json-body.js";

const usersRepository = new DrizzleUsersRepository();
export async function listUsers(context: AppContext) {
  const rows = await usersRepository.listAll();
  const assignments = await usersRepository.listPermissionAssignments();
  return context.json(rows.map(({ user }) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    isAdmin: user.isAdmin,
    active: user.active,
    createdAt: user.createdAt,
    permissions: assignments.filter((assignment) => assignment.userId === user.id).map((assignment) => assignment.key),
  })));
}

export const userCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(320),
  password: passwordSchema,
  permissionKeys: z.array(permissionKeySchema).default([]),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  email: z.string().trim().email().max(320).optional(),
  password: passwordSchema.optional(),
  active: z.boolean().optional(),
  permissionKeys: z.array(permissionKeySchema).optional(),
});

async function assertKnownPermissionKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const known = await usersRepository.findKnownPermissionKeys(keys);
  if (known.length !== keys.length) throw new ApiError(400, "Uma ou mais permissões não existem no catálogo.");
}

export async function createUser(context: AppContext) {
  const input = await jsonBody(context, userCreateSchema);
  await assertKnownPermissionKeys(input.permissionKeys);
  const user = await usersRepository.insert({
    name: input.name,
    email: input.email.toLowerCase(),
    passwordHash: hashPassword(input.password),
  });
  if (!user) throw new ApiError(500, "Não foi possível criar o usuário.");
  await permissionService.assignPermissionKeys(user.id, input.permissionKeys);
  return context.json({ id: user.id }, 201);
}

export async function updateUser(context: AppContext) {
  const userId = z.string().uuid().parse(context.req.param("id"));
  const input = await jsonBody(context, userUpdateSchema);
  if (input.permissionKeys) await assertKnownPermissionKeys(input.permissionKeys);
  const update: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) update.name = input.name;
  if (input.email !== undefined) update.email = input.email.toLowerCase();
  if (input.active !== undefined) update.active = input.active;
  if (input.password !== undefined) update.passwordHash = hashPassword(input.password);
  const user = await usersRepository.update(userId, update);
  if (!user) throw new ApiError(404, "Usuário não encontrado.");
  if (input.permissionKeys) await permissionService.assignPermissionKeys(userId, input.permissionKeys);
  return context.json({ id: user.id });
}

export async function deleteUser(context: AppContext) {
  const userId = z.string().uuid().parse(context.req.param("id"));
  if (userId === context.get("currentUser").id) throw new ApiError(400, "O usuário não pode excluir a própria conta.");
  const deleted = await usersRepository.delete(userId);
  if (deleted.length === 0) throw new ApiError(404, "Usuário não encontrado.");
  return context.body(null, 204);
}

export async function listPermissions(context: AppContext) {
  return context.json(await usersRepository.listSystemPermissions());
}
