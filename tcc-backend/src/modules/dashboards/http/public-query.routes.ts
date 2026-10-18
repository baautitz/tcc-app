import { Hono } from "hono";
import { authentication, type AppVariables } from "../../../shared/middleware/auth.js";
import { runPublicQuery } from "./public-query.controller.js";

export const publicQueryRoutes = new Hono<{ Variables: AppVariables }>();
publicQueryRoutes.get("/query/:uuid", authentication, runPublicQuery);
