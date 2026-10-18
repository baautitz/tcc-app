import { Hono } from "hono";
import { authentication, permissionRequired, type AppVariables } from "../shared/middleware/auth.js";
import { listPermissions } from "../controllers/users.js";

export const permissionRoutes = new Hono<{ Variables: AppVariables }>();
permissionRoutes.get("/api/permissions", authentication, permissionRequired("permissions:read"), listPermissions);
