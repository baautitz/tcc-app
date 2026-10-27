import type {
  Dashboard,
  DashboardArgument,
  DashboardComponent,
} from "@/modules/dashboards/model/types";
import type { DashboardComponentChange, FilterValues } from "./types";

/** Paleta única dos gráficos (--chart-1..10), usada por todos os renderers. */
export const colors = Array.from(
  { length: 10 },
  (_, index) => `var(--chart-${index + 1})`,
);
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
export type PivotedSeries = { key: string; label: string };

/**
 * Uma série por valor de `seriesKey`. Os valores ficam sob a chave
 * `serie:<valor>` para não colidir com o eixo X (`nameKey`); linhas sem nome
 * no eixo X são descartadas.
 */
export function pivotSeries(
  rows: Record<string, unknown>[],
  nameKey: string,
  valueKey: string,
  seriesKey: string,
): { data: Record<string, unknown>[]; series: PivotedSeries[] } {
  const series: PivotedSeries[] = [];
  const byName = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const rawName = row[nameKey];
    if (rawName === null || rawName === undefined || rawName === "") continue;
    const label = String(row[seriesKey] ?? "");
    const key = `serie:${label}`;
    if (!series.some((item) => item.key === key)) series.push({ key, label });
    const name = String(rawName);
    const point = byName.get(name) ?? { [nameKey]: rawName };
    point[key] = row[valueKey];
    byName.set(name, point);
  }
  return { data: [...byName.values()], series };
}
