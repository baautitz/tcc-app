import type { User } from "@/modules/identity/model/types";
import type { QueryParameter } from "@/modules/queries/model/types";

export type DashboardSummary = {
  id: string;
  name: string;
  description: string | null;
};

export type DashboardComponent = {
  id: string;
  type: "stat_card" | "bar_chart" | "line_chart" | "pie_chart" | "data_table";
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

export type DashboardUser = Pick<User, "id" | "name" | "email" | "active">;

export type QueryState = {
  loading: boolean;
  rows?: Record<string, unknown>[];
  error?: string;
  previewPending?: string;
};
export type FilterValues = Record<string, string | string[]>;
export type DashboardFilterValues = Record<string, string | string[]>;
export type DashboardComponentChange = "added" | "modified" | "unchanged";
