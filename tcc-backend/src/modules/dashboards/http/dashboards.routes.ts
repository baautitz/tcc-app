import { Hono } from "hono";
import { adminRequired, authentication, type AppVariables } from "../../../shared/middleware/auth.js";
import { createAdminDashboard, getAdminDashboard, getDashboard, getDashboardUsers, listDashboards, setDashboardUsers, syncDashboards, updateAdminDashboard } from "./dashboards.controller.js";

export const dashboardRoutes = new Hono<{ Variables: AppVariables }>();
dashboardRoutes.post("/api/dashboards/sync", authentication, adminRequired, syncDashboards);
dashboardRoutes.post("/api/admin/dashboards", authentication, adminRequired, createAdminDashboard);
dashboardRoutes.get("/api/admin/dashboards/:id", authentication, adminRequired, getAdminDashboard);
dashboardRoutes.put("/api/admin/dashboards/:id", authentication, adminRequired, updateAdminDashboard);
dashboardRoutes.get("/api/admin/dashboards/:id/users", authentication, adminRequired, getDashboardUsers);
dashboardRoutes.put("/api/admin/dashboards/:id/users", authentication, adminRequired, setDashboardUsers);
dashboardRoutes.get("/api/dashboards", authentication, listDashboards);
dashboardRoutes.get("/api/dashboards/:id", authentication, getDashboard);
