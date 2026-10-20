import type {
  Dashboard,
  DashboardDocument,
  DashboardSummary,
  DashboardUser,
} from "@/modules/dashboards/model/types";
import { httpClient, type HttpClient } from "@/shared/api/client";

export class DashboardsApi {
  constructor(private readonly http: HttpClient) {}

  dashboards = () => this.http.request<DashboardSummary[]>("/api/dashboards");
  dashboard = (id: string) =>
    this.http.request<Dashboard>(`/api/dashboards/${id}`);
  syncDashboards = () =>
    this.http.request<{
      dashboardIds: string[];
      synchronized: number;
      removedOrphans: number;
    }>("/api/dashboards/sync", { method: "POST" });
  createDashboard = (body: { name: string; description: string }) =>
    this.http.request<{ id: string }>("/api/admin/dashboards", {
      method: "POST",
      body: JSON.stringify(body),
    });
  dashboardContext = (id: string) =>
    this.http.request<{ document: DashboardDocument; revision: string }>(
      `/api/admin/dashboards/${encodeURIComponent(id)}`,
    );
  updateDashboardContext = (
    id: string,
    body: DashboardDocument,
    expectedRevision: string,
  ) =>
    this.http.request<{ id: string; saved: boolean; revision: string }>(
      `/api/admin/dashboards/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: JSON.stringify({ document: body, expectedRevision }),
      },
    );
  commitAiDashboardProposal = (
    proposalId: string,
    acknowledgeTruncation = false,
  ) =>
    this.http.request<{
      id: string;
      mode: "create" | "update";
      alreadyApplied: boolean;
    }>(
      `/api/admin/ai/dashboard-proposals/${encodeURIComponent(proposalId)}/commit`,
      { method: "POST", body: JSON.stringify({ acknowledgeTruncation }) },
    );
  previewAiDashboardProposal = (
    proposalId: string,
    contextValues: Record<string, string | string[]>,
    componentIds: string[],
  ) =>
    this.http.request<{
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
    );
  dashboardUsers = (id: string) =>
    this.http.request<{ users: DashboardUser[]; userIds: string[] }>(
      `/api/admin/dashboards/${encodeURIComponent(id)}/users`,
    );
  updateDashboardUsers = (id: string, userIds: string[]) =>
    this.http.request<{ dashboardId: string; userIds: string[] }>(
      `/api/admin/dashboards/${encodeURIComponent(id)}/users`,
      { method: "PUT", body: JSON.stringify({ userIds }) },
    );
}

export const dashboardsApi = new DashboardsApi(httpClient);
