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
import { telemetry } from "./container.js";
import {
  definitionAttributes,
  httpTelemetry,
  queryRowsAttributes,
} from "./shared/middleware/http-telemetry.js";
import { publicQueryRoutes } from "./modules/dashboards/http/public-query.routes.js";

const environment = getEnvironment();
const app = new Hono<{ Variables: AppVariables }>();

app.use(
  "*",
  cors({
    origin: environment.FRONTEND_ORIGIN,
    credentials: true,
    allowHeaders: ["Content-Type", "X-Participant-Id"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);
app.onError(errorHandler);

// Medição de L_dashboard: a definição do dashboard e cada query são requisições separadas.
app.use(
  "/api/dashboards/:id",
  httpTelemetry(telemetry, "http.dashboard.definition", {
    participantFallback: environment.TELEMETRY_PARTICIPANT,
    attributes: (path) => ({ dashboardId: path.id }),
    inspect: definitionAttributes,
  }),
);
app.use(
  "/query/:uuid",
  httpTelemetry(telemetry, "http.dashboard.query", {
    participantFallback: environment.TELEMETRY_PARTICIPANT,
    attributes: (path) => ({ queryUuid: path.uuid }),
    inspect: queryRowsAttributes,
  }),
);

app.get("/api/health", (context) =>
  context.json({ status: "ok", timestamp: new Date().toISOString() }),
);

for (const routes of [
  aiAdminRoutes,
  authRoutes,
  userRoutes,
  permissionRoutes,
  dashboardRoutes,
  dataSourceRoutes,
  queryRoutes,
  publicQueryRoutes,
]) {
  app.route("/", routes);
}

export { app };
