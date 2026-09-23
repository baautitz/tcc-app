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
};

export type QueryParameter = {
  name: string;
  label: string;
  type: "text" | "number" | "date" | "boolean" | "multi_select";
  required: boolean;
};

export type Dashboard = DashboardSummary & {
  definition: DashboardDefinition;
  queryParameters: Array<{ queryUuid: string; parameters: QueryParameter[] }>;
};

export type User = CurrentUser & { active: boolean; createdAt: string };

export type DataSource = {
  id: string;
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
};

export type QuerySummary = {
  id: string;
  dashboardId: string;
  dataSourceId: string;
  name: string;
  parameters: QueryParameter[];
  requiredPermissionKeys: string[];
};

export type SavedQuery = QuerySummary & {
  sqlText: string;
};
