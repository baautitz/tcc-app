import { type Context, type Next } from "hono";
import { getCookie } from "hono/cookie";

import { findAuthenticatedUser, SESSION_COOKIE } from "../../modules/identity/application/auth.js";
import { hasPermission, type AuthenticatedUser } from "../../modules/identity/domain/auth-user.js";

export type AppVariables = { currentUser: AuthenticatedUser };
export type AppContext = Context<{ Variables: AppVariables }>;

export async function authentication(context: AppContext, next: Next): Promise<Response | void> {
  const currentUser = await findAuthenticatedUser(getCookie(context, SESSION_COOKIE));
  if (!currentUser) return context.json({ error: "Sessão inválida, expirada ou revogada." }, 401);
  context.set("currentUser", currentUser);
  await next();
}

export function permissionRequired(permission: string) {
  return async (context: AppContext, next: Next): Promise<Response | void> => {
    const currentUser = context.get("currentUser");
    if (!hasPermission(currentUser, permission)) {
      return context.json({ error: `Acesso negado: a permissão '${permission}' é necessária.` }, 403);
    }
    await next();
  };
}

export async function adminRequired(context: AppContext, next: Next): Promise<Response | void> {
  if (!context.get("currentUser").isAdmin) return context.json({ error: "Acesso restrito ao administrador." }, 403);
  await next();
}
