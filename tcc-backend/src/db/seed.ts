import { eq } from "drizzle-orm";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { db, pool } from "./client.js";
import { users, permissions } from "./schema.js";
import { hashPassword } from "../lib/passwords.js";
import { assignPermissionKeys, ensureSystemPermissions } from "../services/permissions.js";
import { registerRecipeSource } from "../services/recipes.js";

const ADMIN_EMAIL = "admin@tcc.local";
const ADMIN_PASSWORD = "Admin@123";

try {
  const recipeSource = process.argv[2] ?? pathToFileURL(resolve(process.cwd(), "recipes/fechamento-mes.json")).href;
  await registerRecipeSource(recipeSource);
  await ensureSystemPermissions();
  const existingAdmin = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const administrator = existingAdmin[0] ?? (await db.insert(users).values({
    name: "Administrador TCC",
    email: ADMIN_EMAIL,
    passwordHash: hashPassword(ADMIN_PASSWORD),
    isAdmin: true,
  }).returning())[0];

  if (!administrator) throw new Error("Não foi possível criar o administrador inicial.");
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, administrator.id));
  const systemPermissionKeys = (await db.select({ key: permissions.key }).from(permissions).where(eq(permissions.system, true))).map((permission) => permission.key);
  await assignPermissionKeys(administrator.id, systemPermissionKeys);
  console.info(`Administrador de desenvolvimento pronto: ${ADMIN_EMAIL}`);
} finally {
  await pool.end();
}
