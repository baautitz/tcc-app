import { z } from "zod";
import {
  maxDashboardColumns,
  maxDashboardRows,
} from "../../../shared/lib/contracts.js";

export type SpanRange = { min: number; max: number };

export interface ComponentShape {
  type: string;
  /** Colunas do resultado (data_table). */
  columns?: number;
  /** Linhas da amostra. */
  rows?: number;
  /** Categorias (bar/pie) ou pontos (line) da amostra. */
  categories?: number;
}

export interface SizeRange {
  colSpan: SpanRange;
  rowSpan: SpanRange;
}

/** Faixa válida de tamanho (em Células) derivada do formato dos dados. */
export function sizeRangeFor(shape: ComponentShape): SizeRange {
  if (shape.type === "stat_card") {
    return { colSpan: { min: 3, max: 4 }, rowSpan: { min: 2, max: 2 } };
  }
  if (shape.type === "pie_chart") {
    return { colSpan: { min: 4, max: 6 }, rowSpan: { min: 4, max: 5 } };
  }
  if (shape.type === "bar_chart" || shape.type === "line_chart") {
    const dense = (shape.categories ?? 0) > 8;
    return {
      colSpan: dense ? { min: 8, max: 12 } : { min: 6, max: 8 },
      rowSpan: { min: 4, max: 6 },
    };
  }
  const wide = (shape.columns ?? 0) > 4;
  return {
    colSpan: wide ? { min: 12, max: 12 } : { min: 6, max: 8 },
    rowSpan: { min: 4, max: 8 },
  };
}

const clamp = (value: number, range: SpanRange) =>
  Math.min(range.max, Math.max(range.min, value));

/** Leva um tamanho para dentro da faixa válida. */
export function clampSize(
  size: { colSpan: number; rowSpan: number },
  range: SizeRange,
) {
  return {
    colSpan: clamp(size.colSpan, range.colSpan),
    rowSpan: clamp(size.rowSpan, range.rowSpan),
  };
}

export interface CompositionItem extends ComponentShape {
  id: string;
  colSpan: number;
  rowSpan: number;
  /** Tamanho definido pelo administrador: a validação o respeita. */
  explicit?: boolean;
}

export type CompositionRule =
  | "row-not-closed"
  | "row-height-mismatch"
  | "wide-table-narrow"
  | "hierarchy";

export interface CompositionIssue {
  rule: CompositionRule;
  componentIds: string[];
  message: string;
}

const hierarchyRank = (type: string) =>
  type === "stat_card" ? 0 : type === "data_table" ? 2 : 1;

/** Fileiras formadas pela ordem de leitura numa Grade de 12 colunas. */
function toRows(items: CompositionItem[]) {
  const rows: CompositionItem[][] = [];
  let used = 0;
  for (const item of items) {
    if (!rows.length || used + item.colSpan > maxColumns) {
      rows.push([]);
      used = 0;
    }
    rows[rows.length - 1]!.push(item);
    used += item.colSpan;
  }
  return rows;
}

const maxColumns = 12;

/** Mede a Composição pelos princípios de Gestalt; vazio = organizada. */
export function validateComposition(
  items: CompositionItem[],
): CompositionIssue[] {
  const issues: CompositionIssue[] = [];

  for (const row of toRows(items)) {
    if (row.some((item) => item.explicit)) continue;
    const ids = row.map((item) => item.id);
    const width = row.reduce((sum, item) => sum + item.colSpan, 0);
    if (width < maxColumns) {
      issues.push({
        rule: "row-not-closed",
        componentIds: ids,
        message: `A fileira com ${ids.join(", ")} soma ${width} de ${maxColumns} Células de largura; ajuste os colSpan para fechar ${maxColumns}.`,
      });
    }
    if (new Set(row.map((item) => item.rowSpan)).size > 1) {
      issues.push({
        rule: "row-height-mismatch",
        componentIds: ids,
        message: `Os componentes ${ids.join(", ")} estão na mesma fileira com alturas diferentes; use o mesmo rowSpan.`,
      });
    }
  }

  for (const item of items) {
    if (
      item.type === "data_table" &&
      (item.columns ?? 0) > 4 &&
      item.colSpan < maxColumns &&
      !item.explicit
    ) {
      issues.push({
        rule: "wide-table-narrow",
        componentIds: [item.id],
        message: `A tabela ${item.id} tem ${item.columns} colunas e precisa de colSpan ${maxColumns}.`,
      });
    }
  }

  let highest = 0;
  for (const item of items) {
    const rank = hierarchyRank(item.type);
    if (rank < highest && !item.explicit) {
      issues.push({
        rule: "hierarchy",
        componentIds: [item.id],
        message: `${item.id} deve vir antes: indicadores primeiro, depois gráficos, tabela detalhada por último.`,
      });
    }
    highest = Math.max(highest, rank);
  }

  return issues;
}

export const layoutOverrideSchema = z
  .array(
    z
      .object({
        id: z.string().min(1).max(160),
        colSpan: z.number().int().min(1).max(maxDashboardColumns),
        rowSpan: z.number().int().min(1).max(maxDashboardRows),
      })
      .strict(),
  )
  .max(200);

export type LayoutOverride = z.infer<typeof layoutOverrideSchema>;

/**
 * Aplica o layout que o administrador ajustou no preview: só ordem e
 * tamanhos, por ID da proposta. O conteúdo (travado pelo Recibo) não muda.
 */
export function applyLayoutOverride<
  T extends {
    ui: {
      components: {
        id: string;
        layoutProps: { colSpan: number; rowSpan: number };
      }[];
    };
  },
>(document: T, override: unknown): T {
  const entries = layoutOverrideSchema.parse(override);
  const byId = new Map(document.ui.components.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const ordered = entries.map(({ id, colSpan, rowSpan }) => {
    const component = byId.get(id);
    if (!component)
      throw new Error(`O componente '${id}' não pertence à proposta.`);
    if (seen.has(id))
      throw new Error(`O componente '${id}' aparece repetido no layout.`);
    seen.add(id);
    return { ...component, layoutProps: { colSpan, rowSpan } };
  });
  const rest = document.ui.components.filter((c) => !seen.has(c.id));
  return {
    ...document,
    ui: { ...document.ui, components: [...ordered, ...rest] },
  };
}
