/** Lado de uma Célula, em px; fixo em qualquer largura de tela. */
export const CELL_SIZE = 120;
/** Espaçamento fixo entre Células, em px, nos dois eixos. */
export const GRID_GAP = 16;
/** Máximo de colunas da Grade e de Células de um Componente (colSpan/rowSpan). */
export const MAX_COLUMNS = 12;

export type GridMetrics = { columns: number; cellSize: number; gap: number };

/**
 * Colunas = quantas Células cabem na largura (1 a 12). A Célula nunca muda de
 * tamanho: a sobra de largura vira margem e a Grade é centralizada.
 */
export function gridMetrics(containerWidth: number): GridMetrics {
  const columns = Math.min(
    MAX_COLUMNS,
    Math.max(
      1,
      Math.floor(
        (Math.max(0, containerWidth) + GRID_GAP) / (CELL_SIZE + GRID_GAP),
      ),
    ),
  );
  return { columns, cellSize: CELL_SIZE, gap: GRID_GAP };
}

/** Largura em px ocupada pelas colunas e pelos gaps; é a do cabeçalho e dos filtros também. */
export function gridWidth({ columns, cellSize, gap }: GridMetrics): number {
  return columns * cellSize + (columns - 1) * gap;
}
