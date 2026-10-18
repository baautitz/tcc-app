import type { DashboardComponent } from "@/modules/dashboards/model/types";
import { numericChartRows, propertyString } from "@/modules/dashboards/model/lib";

export function chartRowsFor(
  component: DashboardComponent,
  rows: Record<string, unknown>[],
) {
  const nameKey =
    propertyString(component, "nameKey") ??
    Object.keys(rows[0] ?? {})[0] ??
    "label";
  const valueKey =
    propertyString(component, "valueKey") ??
    Object.keys(rows[0] ?? {})[1] ??
    "value";
  const chartRows = numericChartRows(rows, valueKey).filter((row) => {
    const category = row[nameKey];
    const value = row[valueKey];
    return category !== null && category !== undefined && String(category).trim() !== ""
      && typeof value === "number" && Number.isFinite(value);
  });
  return { nameKey, valueKey, chartRows };
}

export function chartEmptyMessage(
  rows: Record<string, unknown>[],
  nameKey: string,
  valueKey: string,
) {
  const availableFields = Object.keys(rows[0] ?? {}).slice(0, 16).join(", ") || "nenhuma coluna retornada";
  return `A query retornou dados, mas nenhuma linha corresponde à categoria '${nameKey}' e ao valor numérico '${valueKey}'. Aliases disponíveis: ${availableFields}. Corrija os aliases do componente ou da query.`;
}
