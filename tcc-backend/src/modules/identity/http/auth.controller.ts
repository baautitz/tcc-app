
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { getEnvironment } from "../../../shared/config/config.js";
import { authService, SESSION_COOKIE } from "../application/auth.js";
import type { AppContext } from "../../../shared/middleware/auth.js";
import { jsonBody } from "../../../shared/middleware/json-body.js";

const deps = { environment: getEnvironment() };

export async function login(context: AppContext) {
  const body = await jsonBody(context, z.object({ email: z.string().email(), password: z.string().min(1) }));
  const user = await authService.authenticate(body.email, body.password);
  const session = await authService.createSession(user.id);
  setCookie(context, SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: deps.environment.NODE_ENV === "production",
    path: "/",
    expires: session.expiresAt,
  });
  const authenticated = await authService.findAuthenticatedUser(session.token);
  return context.json({ user: authenticated });
}

export async function logout(context: AppContext) {
  await authService.revokeSession(getCookie(context, SESSION_COOKIE));
  deleteCookie(context, SESSION_COOKIE, { path: "/" });
  return context.body(null, 204);
}

export function me(context: AppContext) {
  return context.json({ user: context.get("currentUser") });
}
