import { MAX_COLUMNS } from "./grid";
import { placeComponents, type GridItemSize } from "./grid-placement";
import type { DashboardComponent, DashboardDocument } from "./types";

const clampSpan = (value: number) =>
  Math.min(MAX_COLUMNS, Math.max(1, Math.round(value)));

/** Novo tamanho depois de puxar uma borda por `deltaCols` e `deltaRows` Células. */
export function resizeSpans(
  current: GridItemSize,
  deltaCols: number,
  deltaRows: number,
): GridItemSize {
  return {
    colSpan: clampSpan(current.colSpan + deltaCols),
    rowSpan: clampSpan(current.rowSpan + deltaRows),
  };
}

/**
 * Índice em que o componente arrastado entra na lista ao ser solto sobre a
 * Célula (targetCol, targetRow): quantos dos outros começam antes dela na ordem
 * de leitura. Usa só os outros, então não oscila enquanto se arrasta.
 */
export function dropIndex(
  others: GridItemSize[],
  columns: number,
  targetCol: number,
  targetRow: number,
): number {
  return placeComponents(others, columns).filter(
    (place) =>
      place.row < targetRow ||
      (place.row === targetRow && place.col < targetCol),
  ).length;
}

/** Move o item `id` para `toIndex`, contado na lista sem ele. */
export function moveItem<T extends { id: string }>(
  list: T[],
  id: string,
  toIndex: number,
): T[] {
  const item = list.find((entry) => entry.id === id);
  if (!item) return list;
  const rest = list.filter((entry) => entry.id !== id);
  return [...rest.slice(0, toIndex), item, ...rest.slice(toIndex)];
}

/**
 * Grava no documento a ordem e os tamanhos do rascunho. Componentes que o
 * rascunho não conhece ficam no fim; ids que não existem mais são ignorados.
 */
export function applyLayoutToDocument(
  document: DashboardDocument,
  draft: Pick<DashboardComponent, "id" | "layoutProps">[],
): DashboardDocument {
  const byId = new Map(
    document.ui.components.map((component) => [component.id, component]),
  );
  const draftIds = new Set<string>();
  const ordered = draft.flatMap(({ id, layoutProps }) => {
    const component = byId.get(id);
    if (!component || draftIds.has(id)) return [];
    draftIds.add(id);
    return [{ ...component, layoutProps: { ...layoutProps } }];
  });
  const rest = document.ui.components.filter(
    (component) => !draftIds.has(component.id),
  );
  return {
    ...document,
    ui: { ...document.ui, components: [...ordered, ...rest] },
  };
}

export interface LayoutOverrideEntry {
  id: string;
  colSpan: number;
  rowSpan: number;
}

/**
 * Layout a enviar no commit: a ordem de `all` com o rascunho (um subconjunto,
 * já reordenado) ocupando as vagas dos seus componentes. Quem o rascunho não
 * mostra fica no lugar e com o tamanho atual.
 */
export function toLayoutOverride(
  all: Pick<DashboardComponent, "id" | "layoutProps">[],
  draft: Pick<DashboardComponent, "id" | "layoutProps">[],
): LayoutOverrideEntry[] {
  const draftIds = new Set(draft.map((item) => item.id));
  const queue = draft.filter((item) =>
    all.some((candidate) => candidate.id === item.id),
  );
  return all.map((item) => {
    const chosen = draftIds.has(item.id) ? queue.shift()! : item;
    return {
      id: chosen.id,
      colSpan: chosen.layoutProps.colSpan,
      rowSpan: chosen.layoutProps.rowSpan,
    };
  });
}

const hierarchyRank = (type: string) =>
  type === "stat_card" ? 0 : type === "data_table" ? 2 : 1;

/**
 * Reorganiza pela Gestalt, numa Grade de 12 colunas: indicadores no topo,
 * gráficos no meio, tabela por último (a ordem relativa se mantém dentro de
 * cada grupo); cada fileira fecha 12 de largura e tem a altura do maior.
 */
export function organizeLayout<
  T extends { type: string; layoutProps: GridItemSize },
>(components: T[]): T[] {
  const sorted = components
    .map((component, index) => ({ component, index }))
    .sort(
      (a, b) =>
        hierarchyRank(a.component.type) - hierarchyRank(b.component.type) ||
        a.index - b.index,
    )
    .map(({ component }) => component);
  const wide = (component: T) =>
    component.type === "data_table" ? MAX_COLUMNS : component.layoutProps.colSpan;

  const rows: T[][] = [];
  let used = 0;
  for (const component of sorted) {
    const width = Math.min(MAX_COLUMNS, wide(component));
    if (!rows.length || used + width > MAX_COLUMNS) {
      rows.push([]);
      used = 0;
    }
    rows[rows.length - 1]!.push(component);
    used += width;
  }

  return rows.flatMap((row) => {
    const widths = row.map((component) => Math.min(MAX_COLUMNS, wide(component)));
    const extra = MAX_COLUMNS - widths.reduce((sum, width) => sum + width, 0);
    const share = Math.floor(extra / row.length);
    const remainder = extra - share * row.length;
    const height = Math.max(...row.map((c) => c.layoutProps.rowSpan));
    return row.map((component, position) => ({
      ...component,
      layoutProps: {
        colSpan:
          widths[position]! +
          share +
          (position >= row.length - remainder ? 1 : 0),
        rowSpan: height,
      },
    }));
  });
}
