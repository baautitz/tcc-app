import type {
  CurrentUser,
  Permission,
  User,
} from "@/modules/identity/model/types";
import { request } from "@/shared/api/client";

export const identityApi = {
  login: (email: string, password: string) =>
    request<{ user: CurrentUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  me: () => request<{ user: CurrentUser }>("/api/auth/me"),
  users: () => request<User[]>("/api/users"),
  createUser: (body: unknown) =>
    request<{ id: string }>("/api/users", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateUser: (id: string, body: unknown) =>
    request<{ id: string }>(`/api/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteUser: (id: string) =>
    request<void>(`/api/users/${id}`, { method: "DELETE" }),
  permissions: () => request<Permission[]>("/api/permissions"),
};
