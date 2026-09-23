import type { CurrentUser, Dashboard, DashboardSummary, DataSource, DataSourceTable, Permission, QuerySummary, SavedQuery, User } from "./types";

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
      ? body.error
      : "A requisição falhou.";
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export const api = {
  login: (email: string, password: string) => request<{ user: CurrentUser }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  me: () => request<{ user: CurrentUser }>("/api/auth/me"),
  dashboards: () => request<DashboardSummary[]>("/api/dashboards"),
  dashboard: (id: string) => request<Dashboard>(`/api/dashboards/${id}`),
  query: (id: string, params: URLSearchParams) => request<{ rows: Record<string, unknown>[] }>(`/query/${id}?${params.toString()}`),
  users: () => request<User[]>("/api/users"),
  createUser: (body: unknown) => request<{ id: string }>("/api/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id: string, body: unknown) => request<{ id: string }>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteUser: (id: string) => request<void>(`/api/users/${id}`, { method: "DELETE" }),
  permissions: () => request<Permission[]>("/api/permissions"),
  createPermission: (body: unknown) => request<Permission>("/api/permissions", { method: "POST", body: JSON.stringify(body) }),
  updatePermission: (id: string, body: unknown) => request<Permission>(`/api/permissions/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deletePermission: (id: string) => request<void>(`/api/permissions/${id}`, { method: "DELETE" }),
  dataSources: () => request<DataSource[]>("/api/data-sources"),
  dataSource: (id: string) => request<DataSource & { tables: DataSourceTable[] }>(`/api/data-sources/${id}`),
  createDataSource: (body: unknown) => request<DataSource>("/api/data-sources", { method: "POST", body: JSON.stringify(body) }),
  updateDataSource: (id: string, body: unknown) => request<DataSource>(`/api/data-sources/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteDataSource: (id: string) => request<void>(`/api/data-sources/${id}`, { method: "DELETE" }),
  updateTableContext: (sourceId: string, tableId: string, context: string) => request<DataSourceTable>(`/api/data-sources/${sourceId}/tables/${tableId}`, { method: "PATCH", body: JSON.stringify({ context }) }),
  adminDashboards: () => request<Array<DashboardSummary & { definition: Dashboard["definition"] }>>("/api/admin/dashboards"),
  createDashboard: (body: unknown) => request<DashboardSummary>("/api/dashboards", { method: "POST", body: JSON.stringify(body) }),
  updateDashboard: (id: string, body: unknown) => request<DashboardSummary>(`/api/dashboards/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteDashboard: (id: string) => request<void>(`/api/dashboards/${id}`, { method: "DELETE" }),
  queries: () => request<QuerySummary[]>("/api/queries"),
  savedQuery: (id: string) => request<SavedQuery>(`/api/queries/${id}`),
  createQuery: (body: unknown) => request<SavedQuery>("/api/queries", { method: "POST", body: JSON.stringify(body) }),
  updateQuery: (id: string, body: unknown) => request<SavedQuery>(`/api/queries/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteQuery: (id: string) => request<void>(`/api/queries/${id}`, { method: "DELETE" }),
  testQuery: (id: string, parameters: Record<string, string>) => request<{ rows: Record<string, unknown>[] }>(`/api/queries/${id}/test`, { method: "POST", body: JSON.stringify({ parameters }) }),
};
