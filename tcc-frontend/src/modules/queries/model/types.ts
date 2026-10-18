export type QueryParameter = {
  name: string;
  label: string;
  type: "text" | "number" | "date" | "boolean" | "multi_select";
  required: boolean;
};

export type QuerySummary = {
  id: string;
  dataSourceId: string;
  name: string;
  parameters: QueryParameter[];
  createdAt: string;
  updatedAt: string;
};

export type SavedQuery = QuerySummary & {
  sqlText: string;
};

export type QueryPreview = {
  testRunId: string;
  dataSource: { id: string; name: string };
  purpose?: "dashboard" | "quick_query";
  intent: {
    mode: "create" | "update";
    queryId?: string;
    queryName: string;
    queryUpdatedAt?: string;
  };
  sqlText: string;
  parameters: QueryParameter[];
  testValues: Record<string, string | string[]>;
  rows: Record<string, unknown>[];
  rowCount: number;
  rowLimit: number;
  byteLimit: number;
  bytes: number;
  truncated: boolean;
  truncationReason: "row_limit" | "byte_limit" | null;
};
