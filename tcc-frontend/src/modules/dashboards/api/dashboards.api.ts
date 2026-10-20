import type {
  Dashboard,
  DashboardDocument,
  DashboardSummary,
  DashboardUser,
} from "@/modules/dashboards/model/types";
import { request } from "@/shared/api/client";

export const dashboardsApi = {
  dashboards: () => request<DashboardSummary[]>("/api/dashboards"),
  dashboard: (id: string) => request<Dashboard>(`/api/dashboards/${id}`),
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
  updateDashboardContext: (
    id: string,
    body: DashboardDocument,
    expectedRevision: string,
  ) =>
    request<{ id: string; saved: boolean; revision: string }>(
      `/api/admin/dashboards/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: JSON.stringify({ document: body, expectedRevision }),
      },
    ),
  commitAiDashboardProposal: (
    proposalId: string,
    acknowledgeTruncation = false,
  ) =>
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
      queries: Record<
        string,
        {
          rows: Record<string, unknown>[];
          rowLimit: number;
          byteLimit: number;
          bytes: number;
          truncated: boolean;
          truncationReason: "row_limit" | "byte_limit" | null;
          error?: string;
          previewPending?: string;
        }
      >;
      issues: string[];
    }>(
      `/api/admin/ai/dashboard-proposals/${encodeURIComponent(proposalId)}/preview`,
      {
        method: "POST",
        body: JSON.stringify({ contextValues, componentIds }),
      },
    ),
  dashboardUsers: (id: string) =>
    request<{ users: DashboardUser[]; userIds: string[] }>(
      `/api/admin/dashboards/${encodeURIComponent(id)}/users`,
    ),
  updateDashboardUsers: (id: string, userIds: string[]) =>
    request<{ dashboardId: string; userIds: string[] }>(
      `/api/admin/dashboards/${encodeURIComponent(id)}/users`,
      { method: "PUT", body: JSON.stringify({ userIds }) },
    ),
};
