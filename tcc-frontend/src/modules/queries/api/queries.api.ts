import type { QueryParameter, QueryPreview, QuerySummary, SavedQuery } from "@/modules/queries/model/types";
import { request } from "@/shared/api/client";

export const queriesApi = {
  query: (id: string, params: URLSearchParams) =>
    request<{ rows: Record<string, unknown>[] }>(
      `/query/${id}?${params.toString()}`,
    ),
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
