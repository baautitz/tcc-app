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
