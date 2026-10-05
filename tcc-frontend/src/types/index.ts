export type Permission = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  system: boolean;
};

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  permissions: string[];
};

export type DashboardSummary = {
  id: string;
  name: string;
  description: string | null;
};

export type DashboardComponent = {
  id: string;
  type: "stat_card" | "bar_chart" | "pie_chart" | "data_table";
  title: string;
  queryUuid: string;
  layoutProps: { colSpan: number; rowSpan: number };
  props: Record<string, unknown>;
};

export type DashboardDefinition = {
  layout: { columns: 12; gap: number };
  components: DashboardComponent[];
  workspace: { params: DashboardArgument[] };
  queryBindings: QueryBinding[];
};

export type QueryParameter = {
  name: string;
  label: string;
  type: "text" | "number" | "date" | "boolean" | "multi_select";
  required: boolean;
};

export type DashboardOption = { label: string; value: string };

export type DashboardArgument = QueryParameter & {
  lookup?: { queryUuid: string; valueField: string; labelField: string };
  options?: DashboardOption[];
};

export type QueryBinding = {
  queryUuid: string;
  parameters: Record<string, QueryParameterSource>;
};

export type QueryParameterSource =
  | { source: "context"; argument: string }
  | { source: "manual"; value: string | string[] };

export type DashboardDocumentComponent = {
  id: string;
  component: DashboardComponent["type"];
  layoutProps: { colSpan: number; rowSpan: number };
  props: Record<string, unknown>;
};

export type DashboardDocument = {
  id: string;
  name: string;
  description?: string;
  workspace: { params: DashboardArgument[] };
  queryBindings: QueryBinding[];
  ui: { layout: Record<string, unknown> & { gap: number }; components: DashboardDocumentComponent[] } & Record<string, unknown>;
};

export type Dashboard = DashboardSummary & {
  definition: DashboardDefinition;
};

export type User = CurrentUser & { active: boolean; createdAt: string };

export type DashboardUser = Pick<User, "id" | "name" | "email" | "active">;

export type DataSource = {
  id: string;
  updatedAt: string;
  contextVersion: number;
  name: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  context: string;
};

export type DataSourceTable = {
  id: string;
  dataSourceId: string;
  schemaName: string;
  tableName: string;
  context: string;
  contextVersion: number;
};

export type AiContextProposal = {
  id: string;
  actorId: string;
  targetType: "source" | "table";
  dataSourceId: string;
  tableId: string | null;
  sourceName: string;
  schemaName: string | null;
  tableName: string | null;
  baseContextVersion: number;
  currentContext: string;
  proposedContext: string;
  reason: string;
  status: "pending" | "approved" | "dismissed" | "stale" | "expired";
  expiresAt: string;
  createdAt: string;
  resolvedAt: string | null;
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
