export type GridItemSize = { colSpan: number; rowSpan: number };
export type GridPlacement = {
  /** Coluna e linha iniciais, contadas a partir de 1. */
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
};

/**
 * Posiciona cada item na primeira posição livre que não vem antes do item
 * anterior na ordem de leitura (esquerda para direita, de cima para baixo).
 * Pode preencher espaço ao lado de um item alto, mas nunca sobe acima do
 * anterior. O colSpan é limitado ao número de colunas.
 */
export function placeComponents(
  items: GridItemSize[],
  columns: number,
): GridPlacement[] {
  const occupied = new Set<string>();
  const isFree = (
    col: number,
    row: number,
    colSpan: number,
    rowSpan: number,
  ) => {
    for (let r = row; r < row + rowSpan; r++)
      for (let c = col; c < col + colSpan; c++)
        if (occupied.has(`${String(c)}:${String(r)}`)) return false;
    return true;
  };

  let cursorCol = 1;
  let cursorRow = 1;
  return items.map((item) => {
    const colSpan = Math.min(columns, Math.max(1, item.colSpan));
    const rowSpan = Math.max(1, item.rowSpan);
    let col = cursorCol;
    let row = cursorRow;
    while (col + colSpan - 1 > columns || !isFree(col, row, colSpan, rowSpan)) {
      col += 1;
      if (col > columns) {
        col = 1;
        row += 1;
      }
    }
    for (let r = row; r < row + rowSpan; r++)
      for (let c = col; c < col + colSpan; c++)
        occupied.add(`${String(c)}:${String(r)}`);
    cursorCol = col;
    cursorRow = row;
    return { col, row, colSpan, rowSpan };
  });
}
