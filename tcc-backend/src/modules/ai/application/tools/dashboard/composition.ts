import {
  clampSize,
  sizeRangeFor,
  validateComposition,
  type CompositionIssue,
  type CompositionItem,
} from "../../../../dashboards/domain/dashboard-composition.js";
import {
  dashboardComponentTypes,
  defaultColSpanByType,
  defaultRowSpanByType,
} from "../../../../../shared/lib/contracts.js";
import type { DashboardDocument } from "../../../../dashboards/domain/dashboards.js";

type Rows = Record<string, unknown>[];

const distinct = (rows: Rows, key: unknown) =>
  typeof key === "string"
    ? new Set(rows.map((row) => String(row[key]))).size
    : rows.length;

const shapeOf = (
  type: string,
  props: Record<string, unknown>,
  rows: Rows,
) => ({
  type,
  rows: rows.length,
  columns: Array.isArray(props.columns)
    ? props.columns.length
    : Object.keys(rows[0] ?? {}).length,
  categories: distinct(rows, props.nameKey),
});

/**
 * Tamanho do componente isolado: o que o administrador pediu, ou o padrão do
 * Tipo levado para a faixa que a amostra pede.
 */
export function suggestComponentSize(
  component: {
    component: (typeof dashboardComponentTypes)[number];
    colSpan?: number;
    rowSpan?: number;
  } & Record<string, unknown>,
  rows: Rows,
) {
  const range = sizeRangeFor(shapeOf(component.component, component, rows));
  const fitted = clampSize(
    {
      colSpan: defaultColSpanByType[component.component],
      rowSpan: defaultRowSpanByType[component.component],
    },
    range,
  );
  return {
    colSpan: component.colSpan ?? fitted.colSpan,
    rowSpan: component.rowSpan ?? fitted.rowSpan,
  };
}

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
    const shape = shapeOf(component.component, props, rows);
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
