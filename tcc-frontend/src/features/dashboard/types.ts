export type QueryState = {
  loading: boolean;
  rows?: Record<string, unknown>[];
  error?: string;
  previewPending?: string;
};
export type FilterValues = Record<string, string | string[]>;
export type DashboardFilterValues = Record<string, string | string[]>;
export type DashboardComponentChange = "added" | "modified" | "unchanged";
