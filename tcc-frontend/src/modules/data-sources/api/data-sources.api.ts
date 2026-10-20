import type {
  DataSource,
  DataSourceTable,
} from "@/modules/data-sources/model/types";
import { request } from "@/shared/api/client";

export const dataSourcesApi = {
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
        body: JSON.stringify({
          context,
          expectedSourceUpdatedAt,
          expectedContextVersion,
        }),
      },
    ),
};
