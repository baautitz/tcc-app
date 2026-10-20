import type {
  CurrentUser,
  Permission,
  User,
} from "@/modules/identity/model/types";
import { httpClient, type HttpClient } from "@/shared/api/client";

export class IdentityApi {
  constructor(private readonly http: HttpClient) {}

  login = (email: string, password: string) =>
    this.http.request<{ user: CurrentUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  logout = () =>
    this.http.request<void>("/api/auth/logout", { method: "POST" });
  me = () => this.http.request<{ user: CurrentUser }>("/api/auth/me");
  users = () => this.http.request<User[]>("/api/users");
  createUser = (body: unknown) =>
    this.http.request<{ id: string }>("/api/users", {
      method: "POST",
      body: JSON.stringify(body),
    });
  updateUser = (id: string, body: unknown) =>
    this.http.request<{ id: string }>(`/api/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  deleteUser = (id: string) =>
    this.http.request<void>(`/api/users/${id}`, { method: "DELETE" });
  permissions = () => this.http.request<Permission[]>("/api/permissions");
}

export const identityApi = new IdentityApi(httpClient);
