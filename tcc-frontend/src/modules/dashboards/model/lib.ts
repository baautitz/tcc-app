import type {
  Dashboard,
  DashboardArgument,
  DashboardComponent,
} from "@/modules/dashboards/model/types";
import type { DashboardComponentChange, FilterValues } from "./types";

export const colors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];
export const colSpanClass: Record<number, string> = {
  1: "col-span-12 @md:col-span-1",
  2: "col-span-12 @md:col-span-2",
  3: "col-span-12 @md:col-span-3",
  4: "col-span-12 @md:col-span-4",
  5: "col-span-12 @md:col-span-5",
  6: "col-span-12 @md:col-span-6",
  7: "col-span-12 @md:col-span-7",
  8: "col-span-12 @md:col-span-8",
  9: "col-span-12 @md:col-span-9",
  10: "col-span-12 @md:col-span-10",
  11: "col-span-12 @md:col-span-11",
  12: "col-span-12",
};
export const gapClass: Record<number, string> = {
  2: "gap-0.5",
  4: "gap-1",
  8: "gap-2",
  12: "gap-3",
  16: "gap-4",
  20: "gap-5",
  24: "gap-6",
  32: "gap-8",
};
export function componentChangeClasses(status?: DashboardComponentChange) {
  switch (status) {
    case "added":
      return {
        card: "border-emerald-600/45 bg-emerald-500/5 dark:border-emerald-400/40 dark:bg-emerald-400/5",
        badge:
          "border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:border-emerald-400/40 dark:text-emerald-300",
        label: "Novo",
      };
    case "modified":
      return {
        card: "border-amber-600/45 bg-amber-500/5 dark:border-amber-400/40 dark:bg-amber-400/5",
        badge:
          "border-amber-600/40 bg-amber-500/10 text-amber-800 dark:border-amber-400/40 dark:text-amber-300",
        label: "Modificado",
      };
    case "unchanged":
      return {
        card: "border-border/70 bg-muted/10",
        badge: "border-border bg-muted text-muted-foreground",
        label: "Sem alteração",
      };
    default:
      return undefined;
  }
}
export function propertyString(
  component: DashboardComponent,
  key: string,
): string | undefined {
  const value = component.props[key];
  return typeof value === "string" ? value : undefined;
}
export function componentColumns(
  component: DashboardComponent,
  rows: Record<string, unknown>[],
): string[] {
  const configured = component.props.columns;
  if (Array.isArray(configured)) {
    const keys = configured.flatMap((item) =>
      typeof item === "object" &&
      item !== null &&
      "key" in item &&
      typeof item.key === "string"
        ? [item.key]
        : [],
    );
    if (keys.length) return keys;
  }
  return rows[0] ? Object.keys(rows[0]) : [];
}
export function collectArguments(dashboard: Dashboard): DashboardArgument[] {
  return dashboard.definition.workspace.params;
}
export function queryArguments(
  dashboard: Dashboard,
  queryUuid: string,
  filters: FilterValues,
): URLSearchParams {
  const search = new URLSearchParams();
  const binding = dashboard.definition.queryBindings.find(
    (item) => item.queryUuid === queryUuid,
  );
  if (!binding) return search;
  for (const [parameterName, source] of Object.entries(binding.parameters)) {
    const value =
      source.source === "manual" ? source.value : filters[source.argument];
    if (Array.isArray(value))
      value
        .filter(Boolean)
        .forEach((item) => search.append(parameterName, item));
    else if (value) search.set(parameterName, value);
  }
  return search;
}
export function isIsoDateValue(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
export function numericChartRows(
  rows: Record<string, unknown>[],
  valueKey: string,
): Record<string, unknown>[] {
  return rows.map((row) => {
    const value = row[valueKey];
    if (typeof value !== "string" || value.trim() === "") return row;
    const numericValue = Number(value);
    return Number.isFinite(numericValue)
      ? { ...row, [valueKey]: numericValue }
      : row;
  });
}
export function colClass(component: DashboardComponent): string {
  return (
    colSpanClass[Math.min(12, Math.max(1, component.layoutProps.colSpan))] ??
    "col-span-12"
  );
}
