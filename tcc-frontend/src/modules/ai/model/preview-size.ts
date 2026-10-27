import { CELL_SIZE, GRID_GAP } from "@/modules/dashboards/model/grid";

type Span = { colSpan: number; rowSpan: number };

const defaults: Record<string, Span> = {
  stat_card: { colSpan: 3, rowSpan: 2 },
  data_table: { colSpan: 12, rowSpan: 6 },
};
const fallback: Span = { colSpan: 6, rowSpan: 5 };

const pixels = (cells: number) => cells * CELL_SIZE + (cells - 1) * GRID_GAP;

/**
 * Altura do componente isolado no chat: mantém a proporção que ele terá no
 * dashboard (tamanho sugerido) na largura disponível, sem virar uma torre
 * nem sumir. O chat não usa a Grade de Células: ela é estreita demais.
 */
export function previewHeight(
  width: number,
  type: string,
  suggested?: Span,
): number {
  const size = suggested ?? defaults[type] ?? fallback;
  const ratio = pixels(size.rowSpan) / pixels(size.colSpan);
  const min = type === "stat_card" ? 96 : 220;
  const max = type === "stat_card" ? 160 : 380;
  return Math.round(Math.min(max, Math.max(min, width * ratio)));
}
