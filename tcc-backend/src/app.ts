import { Hono } from "hono";
import { cors } from "hono/cors";
import { getEnvironment } from "./shared/config/config.js";
import { errorHandler } from "./shared/middleware/error-handler.js";
import type { AppVariables } from "./shared/middleware/auth.js";
import { aiAdminRoutes } from "./routes/ai-admin.js";
import { authRoutes } from "./routes/auth.js";
import { userRoutes } from "./routes/users.js";
import { permissionRoutes } from "./routes/permissions.js";
import { dashboardRoutes } from "./routes/dashboards.js";
import { dataSourceRoutes } from "./routes/data-sources.js";
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
