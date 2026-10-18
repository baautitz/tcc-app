import { Hono } from "hono";
import { authentication, type AppVariables } from "../shared/middleware/auth.js";
import { login, logout, me } from "../controllers/auth.js";

export const authRoutes = new Hono<{ Variables: AppVariables }>();
authRoutes.post("/api/auth/login", login);
authRoutes.post("/api/auth/logout", logout);
authRoutes.get("/api/auth/me", authentication, me);
