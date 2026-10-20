import { randomUUID } from "node:crypto";
import { describe } from "vitest";
import { app } from "../../../src/app.js";
import { db } from "../../../src/shared/db/client.js";
import { users } from "../../../src/shared/db/schema.js";
import { authService } from "../../../src/modules/identity/application/auth.js";

export const integrationEnabled = process.env.TCC_POSTGRES_INTEGRATION === "1";
export const integrationDescribe = (name: string, body: () => void) =>
  describe.runIf(integrationEnabled)(name, body);

export const databaseUrl = new URL(
  process.env.DATABASE_URL ?? "postgres://localhost/undefined",
);
export const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
export const databasePort = Number(databaseUrl.port || "5432");
export const externalDatabasePort = Number(
  process.env.TCC_SMOKE_EXTERNAL_PORT || databasePort,
);

// Guarda: com a flag ligada, só aceita bancos descartáveis (nome com smoke/skip/test).
if (integrationEnabled && !/(smoke|skip|test)/i.test(databaseName))
  throw new Error(
    `Recusado: "${databaseName}" não parece um banco descartável. Nunca rode a integração contra o banco de desenvolvimento.`,
  );

export type SmokeUser = { id: string; token: string };

export async function createUser(
  isAdmin: boolean,
  label = "Context smoke",
): Promise<SmokeUser> {
  const user = (
    await db
      .insert(users)
      .values({
        name: `${label} ${isAdmin ? "admin" : "user"}`,
        email: `${randomUUID()}@example.test`,
        passwordHash: "unused-in-route-smoke",
        isAdmin,
      })
      .returning({ id: users.id })
  )[0];
  if (!user) throw new Error("Could not create an integration test user.");
  return {
    id: user.id,
    token: (await authService.createSession(user.id)).token,
  };
}

export async function jsonRequest(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers();
  if (options.token) headers.set("Cookie", `tcc_session=${options.token}`);
  if (options.body !== undefined)
    headers.set("Content-Type", "application/json");
  return await app.request(`http://localhost${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
}
