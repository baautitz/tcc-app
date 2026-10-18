import { Hono } from "hono";
import { cors } from "hono/cors";
import { getEnvironment } from "./shared/config/config.js";
import { errorHandler } from "./shared/middleware/error-handler.js";
import type { AppVariables } from "./shared/middleware/auth.js";
import { aiAdminRoutes } from "./routes/ai-admin.js";
import { authRoutes } from "./modules/identity/http/auth.routes.js";
import { userRoutes } from "./modules/identity/http/users.routes.js";
import { permissionRoutes } from "./modules/identity/http/permissions.routes.js";
import { dashboardRoutes } from "./routes/dashboards.js";
import { dataSourceRoutes } from "./modules/data-sources/http/data-sources.routes.js";
import { queryRoutes } from "./routes/queries.js";
import { publicQueryRoutes } from "./routes/public-query.js";

const environment = getEnvironment();
const app = new Hono<{ Variables: AppVariables }>();

app.use("*", cors({
  origin: environment.FRONTEND_ORIGIN,
  credentials: true,
  allowHeaders: ["Content-Type"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
}));
app.onError(errorHandler);

app.get("/api/health", (context) => context.json({ status: "ok", timestamp: new Date().toISOString() }));

for (const routes of [aiAdminRoutes, authRoutes, userRoutes, permissionRoutes, dashboardRoutes, dataSourceRoutes, queryRoutes, publicQueryRoutes]) {
  app.route("/", routes);
}

export { app };
