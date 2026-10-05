import { Hono } from "hono";
import { authentication, permissionRequired, type AppVariables } from "../middleware/auth.js";
import { createQuery, deleteQuery, getQuery, listQueries, previewQuery, testSavedQuery, updateQuery } from "../controllers/queries.js";

export const queryRoutes = new Hono<{ Variables: AppVariables }>();
queryRoutes.get("/api/queries", authentication, permissionRequired("queries:read"), listQueries);
queryRoutes.get("/api/queries/:id", authentication, permissionRequired("queries:read"), getQuery);
queryRoutes.post("/api/queries/test", authentication, previewQuery);
queryRoutes.post("/api/queries", authentication, permissionRequired("queries:create"), createQuery);
queryRoutes.patch("/api/queries/:id", authentication, permissionRequired("queries:update"), updateQuery);
queryRoutes.post("/api/queries/:id/test", authentication, permissionRequired("queries:update"), testSavedQuery);
queryRoutes.delete("/api/queries/:id", authentication, permissionRequired("queries:delete"), deleteQuery);
