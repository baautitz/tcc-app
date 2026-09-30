import type {
  CurrentUser,
  Dashboard,
  DashboardDocument,
  DashboardSummary,
  DashboardUser,
  AiContextProposal,
  DataSource,
  DataSourceTable,
  Permission,
  QueryParameter,
  QueryPreview,
  QuerySummary,
  SavedQuery,
  User,
} from "./types";

const baseUrl = (
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
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
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : "A requisição falhou.";
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ user: CurrentUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  me: () => request<{ user: CurrentUser }>("/api/auth/me"),
  dashboards: () => request<DashboardSummary[]>("/api/dashboards"),
  dashboard: (id: string) => request<Dashboard>(`/api/dashboards/${id}`),
  query: (id: string, params: URLSearchParams) =>
    request<{ rows: Record<string, unknown>[] }>(
      `/query/${id}?${params.toString()}`,
    ),
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
  syncDashboards: () =>
    request<{
      dashboardIds: string[];
      synchronized: number;
      removedOrphans: number;
    }>("/api/dashboards/sync", { method: "POST" }),
  createDashboard: (body: { name: string; description: string }) =>
    request<{ id: string }>("/api/admin/dashboards", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  dashboardContext: (id: string) =>
    request<{ document: DashboardDocument; revision: string }>(
      `/api/admin/dashboards/${encodeURIComponent(id)}`,
    ),
  updateDashboardContext: (id: string, body: DashboardDocument, expectedRevision: string) =>
    request<{ id: string; saved: boolean; revision: string }>(
      `/api/admin/dashboards/${encodeURIComponent(id)}`,
      { method: "PUT", body: JSON.stringify({ document: body, expectedRevision }) },
    ),
  commitAiDashboardProposal: (proposalId: string, acknowledgeTruncation = false) =>
    request<{ id: string; mode: "create" | "update"; alreadyApplied: boolean }>(
      `/api/admin/ai/dashboard-proposals/${encodeURIComponent(proposalId)}/commit`,
      { method: "POST", body: JSON.stringify({ acknowledgeTruncation }) },
    ),
  previewAiDashboardProposal: (
    proposalId: string,
    contextValues: Record<string, string | string[]>,
    componentIds: string[],
  ) =>
    request<{
      queries: Record<string, {
        rows: Record<string, unknown>[];
        rowLimit: number;
        byteLimit: number;
        bytes: number;
        truncated: boolean;
        truncationReason: "row_limit" | "byte_limit" | null;
        error?: string;
        previewPending?: string;
      }>;
      issues: string[];
    }>(`/api/admin/ai/dashboard-proposals/${encodeURIComponent(proposalId)}/preview`, {
      method: "POST",
      body: JSON.stringify({ contextValues, componentIds }),
    }),
  dashboardUsers: (id: string) =>
    request<{ users: DashboardUser[]; userIds: string[] }>(
      `/api/admin/dashboards/${encodeURIComponent(id)}/users`,
    ),
  updateDashboardUsers: (id: string, userIds: string[]) =>
    request<{ dashboardId: string; userIds: string[] }>(
      `/api/admin/dashboards/${encodeURIComponent(id)}/users`,
      { method: "PUT", body: JSON.stringify({ userIds }) },
    ),
  createPermission: (body: unknown) =>
    request<Permission>("/api/permissions", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updatePermission: (id: string, body: unknown) =>
    request<Permission>(`/api/permissions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deletePermission: (id: string) =>
    request<void>(`/api/permissions/${id}`, { method: "DELETE" }),
  dataSources: () => request<DataSource[]>("/api/data-sources"),
  dataSource: (id: string) =>
    request<DataSource & { tables: DataSourceTable[] }>(
      `/api/data-sources/${id}`,
    ),
  createDataSource: (body: unknown) =>
    request<DataSource>("/api/data-sources", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateDataSource: (id: string, body: unknown) =>
    request<DataSource>(`/api/data-sources/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteDataSource: (id: string) =>
    request<void>(`/api/data-sources/${id}`, { method: "DELETE" }),
  updateTableContext: (
    sourceId: string,
    tableId: string,
    context: string,
    expectedSourceUpdatedAt: string,
    expectedContextVersion: number,
  ) =>
    request<DataSourceTable>(
      `/api/data-sources/${sourceId}/tables/${tableId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ context, expectedSourceUpdatedAt, expectedContextVersion }),
      },
    ),
  pendingAiContextProposals: () =>
    request<AiContextProposal[]>("/api/admin/ai/context-proposals"),
  aiContextProposal: (id: string) =>
    request<AiContextProposal>(`/api/admin/ai/context-proposals/${encodeURIComponent(id)}`),
  approveAiContextProposal: (id: string) =>
    request<AiContextProposal>(`/api/admin/ai/context-proposals/${encodeURIComponent(id)}/approve`, { method: "POST" }),
  dismissAiContextProposal: (id: string) =>
    request<AiContextProposal>(`/api/admin/ai/context-proposals/${encodeURIComponent(id)}/dismiss`, { method: "POST" }),
  queries: () => request<QuerySummary[]>("/api/queries"),
  savedQuery: (id: string) => request<SavedQuery>(`/api/queries/${id}`),
  createQuery: (body: {
    dataSourceId: string;
    name: string;
    sqlText: string;
    parameters: QueryParameter[];
    testRunId: string;
  }) =>
    request<SavedQuery>("/api/queries", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateQuery: (id: string, body: {
    dataSourceId: string;
    name: string;
    sqlText: string;
    parameters: QueryParameter[];
    testRunId: string;
    expectedUpdatedAt: string;
  }) =>
    request<SavedQuery>(`/api/queries/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  testQueryDraft: (body: {
    dataSourceId: string;
    sqlText: string;
    parameters: QueryParameter[];
    values: Record<string, string | string[]>;
    mode: "create" | "update";
    queryId?: string;
    expectedUpdatedAt?: string;
  }) =>
    request<QueryPreview>("/api/queries/test", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteQuery: (id: string) =>
    request<void>(`/api/queries/${id}`, { method: "DELETE" }),
  testQuery: (id: string, parameters: Record<string, string>) =>
    request<{ rows: Record<string, unknown>[] }>(`/api/queries/${id}/test`, {
      method: "POST",
      body: JSON.stringify({ parameters }),
    }),
};
