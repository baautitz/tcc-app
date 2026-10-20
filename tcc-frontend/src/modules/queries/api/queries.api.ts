import type {
  QueryParameter,
  QueryPreview,
  QuerySummary,
  SavedQuery,
} from "@/modules/queries/model/types";
import { httpClient, type HttpClient } from "@/shared/api/client";

export class QueriesApi {
  constructor(private readonly http: HttpClient) {}

  query = (id: string, params: URLSearchParams) =>
    this.http.request<{ rows: Record<string, unknown>[] }>(
      `/query/${id}?${params.toString()}`,
    );
  queries = () => this.http.request<QuerySummary[]>("/api/queries");
  savedQuery = (id: string) =>
    this.http.request<SavedQuery>(`/api/queries/${id}`);
  createQuery = (body: {
    dataSourceId: string;
    name: string;
    sqlText: string;
    parameters: QueryParameter[];
    testRunId: string;
  }) =>
    this.http.request<SavedQuery>("/api/queries", {
      method: "POST",
      body: JSON.stringify(body),
    });
  updateQuery = (
    id: string,
    body: {
      dataSourceId: string;
      name: string;
      sqlText: string;
      parameters: QueryParameter[];
      testRunId: string;
      expectedUpdatedAt: string;
    },
  ) =>
    this.http.request<SavedQuery>(`/api/queries/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  testQueryDraft = (body: {
    dataSourceId: string;
    sqlText: string;
    parameters: QueryParameter[];
    values: Record<string, string | string[]>;
    mode: "create" | "update";
    queryId?: string;
    expectedUpdatedAt?: string;
  }) =>
    this.http.request<QueryPreview>("/api/queries/test", {
      method: "POST",
      body: JSON.stringify(body),
    });
  deleteQuery = (id: string) =>
    this.http.request<void>(`/api/queries/${id}`, { method: "DELETE" });
  testQuery = (id: string, parameters: Record<string, string>) =>
    this.http.request<{ rows: Record<string, unknown>[] }>(
      `/api/queries/${id}/test`,
      {
        method: "POST",
        body: JSON.stringify({ parameters }),
      },
    );
}

export const queriesApi = new QueriesApi(httpClient);
