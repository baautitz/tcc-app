
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { z } from "zod";
import { getEnvironment } from "../../../shared/config/config.js";
import { DrizzleUsersRepository } from "../infrastructure/users-repository.js";

import { verifyPassword } from "../../../shared/lib/passwords.js";

import { createSession, findAuthenticatedUser, revokeSession, SESSION_COOKIE } from "../application/auth.js";

import { ApiError } from "../../../shared/lib/domain-error.js";

import type { AppContext } from "../../../shared/middleware/auth.js";
import { jsonBody } from "../../../shared/middleware/json-body.js";

const deps = { environment: getEnvironment(), users: new DrizzleUsersRepository() };

export async function login(context: AppContext) {
  const body = await jsonBody(context, z.object({ email: z.string().email(), password: z.string().min(1) }));
  const user = await deps.users.findByEmail(body.email.toLowerCase());
  if (!user || !user.active || !verifyPassword(body.password, user.passwordHash)) {
    throw new ApiError(401, "E-mail ou senha inválidos.");
  }
  const session = await createSession(user.id);
  setCookie(context, SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: deps.environment.NODE_ENV === "production",
    path: "/",
    expires: session.expiresAt,
  });
  const authenticated = await findAuthenticatedUser(session.token);
  return context.json({ user: authenticated });
}

export async function logout(context: AppContext) {
  await revokeSession(getCookie(context, SESSION_COOKIE));
  deleteCookie(context, SESSION_COOKIE, { path: "/" });
  return context.body(null, 204);
}

export function me(context: AppContext) {
  return context.json({ user: context.get("currentUser") });
}
