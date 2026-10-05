import { Hono } from "hono";
import { authentication, type AppVariables } from "../middleware/auth.js";
import { runPublicQuery } from "../controllers/queries.js";

export const publicQueryRoutes = new Hono<{ Variables: AppVariables }>();
publicQueryRoutes.get("/query/:uuid", authentication, runPublicQuery);
