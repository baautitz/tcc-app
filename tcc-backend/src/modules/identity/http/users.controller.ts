import { z } from "zod";
import { passwordSchema, permissionKeySchema } from "../../../shared/lib/contracts.js";
import { userService } from "../application/users.js";
import type { AppContext } from "../../../shared/middleware/auth.js";
import { jsonBody } from "../../../shared/middleware/json-body.js";

export async function listUsers(context: AppContext) {
  return context.json(await userService.listUsers());
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

export async function createUser(context: AppContext) {
  const input = await jsonBody(context, userCreateSchema);
  return context.json(await userService.createUser(input), 201);
}

export async function updateUser(context: AppContext) {
  const userId = z.string().uuid().parse(context.req.param("id"));
  const input = await jsonBody(context, userUpdateSchema);
  return context.json(await userService.updateUser(userId, input));
}

export async function deleteUser(context: AppContext) {
  const userId = z.string().uuid().parse(context.req.param("id"));
  await userService.deleteUser(userId, context.get("currentUser").id);
  return context.body(null, 204);
}

export async function listPermissions(context: AppContext) {
  return context.json(await userService.listSystemPermissions());
}
