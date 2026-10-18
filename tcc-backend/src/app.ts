import { Hono } from "hono";
import { cors } from "hono/cors";
import { getEnvironment } from "./shared/config/config.js";
import { errorHandler } from "./shared/middleware/error-handler.js";
import type { AppVariables } from "./shared/middleware/auth.js";
import { aiAdminRoutes } from "./modules/ai/http/ai-admin.routes.js";
import { authRoutes } from "./modules/identity/http/auth.routes.js";
import { userRoutes } from "./modules/identity/http/users.routes.js";
import { permissionRoutes } from "./modules/identity/http/permissions.routes.js";
import { dashboardRoutes } from "./modules/dashboards/http/dashboards.routes.js";
import { dataSourceRoutes } from "./modules/data-sources/http/data-sources.routes.js";
import { queryRoutes } from "./modules/queries/http/queries.routes.js";
import { configureDashboardFiles } from "./modules/queries/application/query-admin.js";
import { configureExternalSource } from "./modules/data-sources/application/external-source.js";
import { configureSavedQueries } from "./modules/queries/application/saved-queries.js";
import { savedQueriesAdapter } from "./modules/queries/infrastructure/saved-queries-adapter.js";
import { externalSourceAdapter } from "./modules/data-sources/infrastructure/external-source-adapter.js";
import { dashboardFilesAdapter } from "./modules/dashboards/infrastructure/dashboard-files-adapter.js";
import { publicQueryRoutes } from "./modules/dashboards/http/public-query.routes.js";

configureDashboardFiles(dashboardFilesAdapter);
configureExternalSource(externalSourceAdapter);
configureSavedQueries(savedQueriesAdapter);
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
