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

/**
 * Fecha os buracos: depois do encaixe, cada componente (na ordem da lista)
 * cresce para a direita e depois para baixo enquanto as Células vizinhas
 * estiverem livres. Ninguém muda de posição; o crescimento para baixo para na
 * base do layout, então não cria linhas novas. Os tamanhos do autor viram o
 * mínimo de cada componente.
 */
export function expandPlacements(
  placements: GridPlacement[],
  columns: number,
): GridPlacement[] {
  const result = placements.map((place) => ({ ...place }));
  const bottom = Math.max(0, ...result.map((p) => p.row + p.rowSpan - 1));
  const key = (col: number, row: number) => `${String(col)}:${String(row)}`;
  const occupied = new Set<string>();
  for (const p of result)
    for (let r = p.row; r < p.row + p.rowSpan; r++)
      for (let c = p.col; c < p.col + p.colSpan; c++) occupied.add(key(c, r));

  const freeColumn = (col: number, row: number, rowSpan: number) => {
    for (let r = row; r < row + rowSpan; r++)
      if (occupied.has(key(col, r))) return false;
    return true;
  };
  const freeRow = (row: number, col: number, colSpan: number) => {
    for (let c = col; c < col + colSpan; c++)
      if (occupied.has(key(c, row))) return false;
    return true;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const p of result) {
      while (
        p.col + p.colSpan <= columns &&
        freeColumn(p.col + p.colSpan, p.row, p.rowSpan)
      ) {
        for (let r = p.row; r < p.row + p.rowSpan; r++)
          occupied.add(key(p.col + p.colSpan, r));
        p.colSpan += 1;
        changed = true;
      }
      while (
        p.row + p.rowSpan <= bottom &&
        freeRow(p.row + p.rowSpan, p.col, p.colSpan)
      ) {
        for (let c = p.col; c < p.col + p.colSpan; c++)
          occupied.add(key(c, p.row + p.rowSpan));
        p.rowSpan += 1;
        changed = true;
      }
    }
  }
  return result;
}
