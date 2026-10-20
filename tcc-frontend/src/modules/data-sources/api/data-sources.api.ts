import type {
  DataSource,
  DataSourceTable,
} from "@/modules/data-sources/model/types";
import { httpClient, type HttpClient } from "@/shared/api/client";

export class DataSourcesApi {
  constructor(private readonly http: HttpClient) {}

  dataSources = () => this.http.request<DataSource[]>("/api/data-sources");
  dataSource = (id: string) =>
    this.http.request<DataSource & { tables: DataSourceTable[] }>(
      `/api/data-sources/${id}`,
    );
  createDataSource = (body: unknown) =>
    this.http.request<DataSource>("/api/data-sources", {
      method: "POST",
      body: JSON.stringify(body),
    });
  updateDataSource = (id: string, body: unknown) =>
    this.http.request<DataSource>(`/api/data-sources/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  deleteDataSource = (id: string) =>
    this.http.request<void>(`/api/data-sources/${id}`, { method: "DELETE" });
  updateTableContext = (
    sourceId: string,
    tableId: string,
    context: string,
    expectedSourceUpdatedAt: string,
    expectedContextVersion: number,
  ) =>
    this.http.request<DataSourceTable>(
      `/api/data-sources/${sourceId}/tables/${tableId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          context,
          expectedSourceUpdatedAt,
          expectedContextVersion,
        }),
      },
    );
}

export const dataSourcesApi = new DataSourcesApi(httpClient);
