import { eq } from "drizzle-orm";
import { db, pool } from "./client.js";
import { users, permissions } from "./schema.js";
import { hashPassword } from "../lib/passwords.js";
import { assignPermissionKeys, ensureSystemPermissions } from "../services/permissions.js";

const ADMIN_EMAIL = "admin@tcc.local";
const ADMIN_PASSWORD = "Admin@123";

try {
  await ensureSystemPermissions();
  const existingAdmin = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const administrator = existingAdmin[0] ?? (await db.insert(users).values({
    name: "Administrador TCC",
    email: ADMIN_EMAIL,
    passwordHash: hashPassword(ADMIN_PASSWORD),
  }).returning())[0];

  if (!administrator) throw new Error("Não foi possível criar o administrador inicial.");
  const systemPermissionKeys = (await db.select({ key: permissions.key }).from(permissions)).map((permission) => permission.key);
  await assignPermissionKeys(administrator.id, systemPermissionKeys);
  console.info(`Administrador de desenvolvimento pronto: ${ADMIN_EMAIL}`);
} finally {
  await pool.end();
}
