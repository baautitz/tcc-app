import { Hono } from "hono";
import { authentication, permissionRequired, type AppVariables } from "../middleware/auth.js";
import { createUser, deleteUser, listUsers, updateUser } from "../controllers/users.js";

export const userRoutes = new Hono<{ Variables: AppVariables }>();
userRoutes.get("/api/users", authentication, permissionRequired("users:read"), listUsers);
userRoutes.post("/api/users", authentication, permissionRequired("users:create"), createUser);
userRoutes.patch("/api/users/:id", authentication, permissionRequired("users:update"), updateUser);
userRoutes.delete("/api/users/:id", authentication, permissionRequired("users:delete"), deleteUser);
