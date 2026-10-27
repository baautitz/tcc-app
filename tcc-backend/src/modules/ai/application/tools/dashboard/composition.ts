import {
  clampSize,
  sizeRangeFor,
  validateComposition,
  type CompositionIssue,
  type CompositionItem,
} from "../../../../dashboards/domain/dashboard-composition.js";
import type { DashboardDocument } from "../../../../dashboards/domain/dashboards.js";

type Rows = Record<string, unknown>[];

const distinct = (rows: Rows, key: unknown) =>
  typeof key === "string"
    ? new Set(rows.map((row) => String(row[key]))).size
    : rows.length;

/**
 * Dimensiona pela amostra os componentes sem tamanho definido pelo
 * administrador e mede a Composição resultante (Gestalt).
 */
export function composeDashboard(
  document: DashboardDocument,
  rowsByQuery: Record<string, { rows: Rows } | undefined>,
  explicitIds: ReadonlySet<string>,
): { document: DashboardDocument; issues: CompositionIssue[] } {
  const items: CompositionItem[] = [];
  const components = document.ui.components.map((component) => {
    const props = component.props as Record<string, unknown>;
    const rows = rowsByQuery[String(props.queryUuid)]?.rows ?? [];
    const explicit = explicitIds.has(component.id);
    const shape = {
      type: component.component,
      rows: rows.length,
      columns: Array.isArray(props.columns)
        ? props.columns.length
        : Object.keys(rows[0] ?? {}).length,
      categories: distinct(rows, props.nameKey),
    };
    const layoutProps = explicit
      ? component.layoutProps
      : clampSize(component.layoutProps, sizeRangeFor(shape));
    items.push({
      id: component.id,
      ...shape,
      ...layoutProps,
      explicit,
    });
    return { ...component, layoutProps };
  });
  return {
    document: { ...document, ui: { ...document.ui, components } },
    issues: validateComposition(items),
  };
}
