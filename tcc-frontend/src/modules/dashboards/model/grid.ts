/** Lado mínimo de uma Célula, em px. */
export const CELL_MIN = 80;
/** Lado máximo de uma Célula, em px; acima disso a Grade centraliza. */
export const CELL_MAX = 120;
/** Espaçamento fixo entre Células, em px, nos dois eixos. */
export const GRID_GAP = 16;
/** Máximo de colunas da Grade e de Células de um Componente (colSpan/rowSpan). */
export const MAX_COLUMNS = 12;

export type GridMetrics = { columns: number; cellSize: number; gap: number };

/**
 * Colunas = quantas Células mínimas cabem (1 a 12). A sobra de largura é
 * dividida entre as Células, que continuam quadradas, até CELL_MAX.
 */
export function gridMetrics(containerWidth: number): GridMetrics {
  const width = Math.max(0, containerWidth);
  const columns = Math.min(
    MAX_COLUMNS,
    Math.max(1, Math.floor((width + GRID_GAP) / (CELL_MIN + GRID_GAP))),
  );
  const fitted = (width - GRID_GAP * (columns - 1)) / columns;
  return {
    columns,
    cellSize: Math.min(CELL_MAX, Math.max(0, fitted)),
    gap: GRID_GAP,
  };
}
