import { Hono } from "hono";
import { authentication, permissionRequired, type AppVariables } from "../shared/middleware/auth.js";
import { createSource, deleteSource, getSource, listSources, refreshSource, testSource, updateSource, updateTableContext } from "../controllers/data-sources.js";

export const dataSourceRoutes = new Hono<{ Variables: AppVariables }>();
dataSourceRoutes.get("/api/data-sources", authentication, permissionRequired("data-sources:read"), listSources);
dataSourceRoutes.get("/api/data-sources/:id", authentication, permissionRequired("data-sources:read"), getSource);
dataSourceRoutes.post("/api/data-sources/test", authentication, permissionRequired("data-sources:create"), testSource);
dataSourceRoutes.post("/api/data-sources", authentication, permissionRequired("data-sources:create"), createSource);
dataSourceRoutes.patch("/api/data-sources/:id", authentication, permissionRequired("data-sources:update"), updateSource);
dataSourceRoutes.post("/api/data-sources/:id/refresh", authentication, permissionRequired("data-sources:update"), refreshSource);
dataSourceRoutes.patch("/api/data-sources/:sourceId/tables/:tableId", authentication, permissionRequired("data-sources:update"), updateTableContext);
dataSourceRoutes.delete("/api/data-sources/:id", authentication, permissionRequired("data-sources:delete"), deleteSource);
