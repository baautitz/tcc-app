import { describe, expect, it } from "vitest";
import {
  applyLayoutOverride,
  clampSize,
  sizeRangeFor,
  validateComposition,
} from "./dashboard-composition.js";

describe("faixa de tamanho de um Componente", () => {
  it("tabela com muitas colunas ocupa a fileira inteira", () => {
    const range = sizeRangeFor({ type: "data_table", columns: 9, rows: 20 });
    expect(range.colSpan).toEqual({ min: 12, max: 12 });
  });

  it("tabela com poucas colunas não precisa da fileira inteira", () => {
    const range = sizeRangeFor({ type: "data_table", columns: 2, rows: 20 });
    expect(range.colSpan).toEqual({ min: 6, max: 8 });
  });

  it("cartão de indicador é compacto", () => {
    const range = sizeRangeFor({ type: "stat_card" });
    expect(range.colSpan).toEqual({ min: 3, max: 4 });
    expect(range.rowSpan).toEqual({ min: 2, max: 2 });
  });

  it("pizza nunca vira um gráfico enorme", () => {
    const range = sizeRangeFor({ type: "pie_chart", categories: 3 });
    expect(range.colSpan).toEqual({ min: 4, max: 6 });
  });

  it("barras com muitas categorias pedem mais largura", () => {
    const few = sizeRangeFor({ type: "bar_chart", categories: 4 });
    const many = sizeRangeFor({ type: "bar_chart", categories: 15 });
    expect(few.colSpan).toEqual({ min: 6, max: 8 });
    expect(many.colSpan).toEqual({ min: 8, max: 12 });
  });

  it("linha com muitos pontos pede mais largura", () => {
    const range = sizeRangeFor({ type: "line_chart", categories: 40 });
    expect(range.colSpan).toEqual({ min: 8, max: 12 });
  });
});

describe("correção de tamanho fora da faixa", () => {
  it("leva um tamanho estreito demais para dentro da faixa", () => {
    const range = sizeRangeFor({ type: "data_table", columns: 9 });
    expect(clampSize({ colSpan: 3, rowSpan: 2 }, range)).toEqual({
      colSpan: 12,
      rowSpan: 4,
    });
  });

  it("mantém um tamanho que já está na faixa", () => {
    const range = sizeRangeFor({ type: "pie_chart", categories: 3 });
    expect(clampSize({ colSpan: 5, rowSpan: 4 }, range)).toEqual({
      colSpan: 5,
      rowSpan: 4,
    });
  });
});

const item = (
  id: string,
  type: string,
  colSpan: number,
  rowSpan: number,
  extra: { columns?: number; explicit?: boolean } = {},
) => ({ id, type, colSpan, rowSpan, ...extra });

describe("validação da Composição (Gestalt)", () => {
  it("aceita indicadores no topo, gráficos alinhados e tabela por último", () => {
    const issues = validateComposition([
      item("a", "stat_card", 4, 2),
      item("b", "stat_card", 4, 2),
      item("c", "stat_card", 4, 2),
      item("d", "bar_chart", 6, 5),
      item("e", "pie_chart", 6, 5),
      item("f", "data_table", 12, 6, { columns: 8 }),
    ]);
    expect(issues).toEqual([]);
  });

  it("recusa fileira que não fecha a largura", () => {
    const issues = validateComposition([
      item("a", "bar_chart", 6, 5),
      item("b", "pie_chart", 4, 5),
    ]);
    expect(issues.map((i) => i.rule)).toContain("row-not-closed");
  });

  it("recusa alturas diferentes na mesma fileira", () => {
    const issues = validateComposition([
      item("a", "bar_chart", 6, 5),
      item("b", "line_chart", 6, 3),
    ]);
    expect(issues.map((i) => i.rule)).toContain("row-height-mismatch");
  });

  it("recusa tabela larga em largura estreita", () => {
    const issues = validateComposition([
      item("a", "data_table", 6, 6, { columns: 10 }),
      item("b", "bar_chart", 6, 6),
    ]);
    expect(issues.map((i) => i.rule)).toContain("wide-table-narrow");
  });

  it("recusa tabela antes dos indicadores", () => {
    const issues = validateComposition([
      item("t", "data_table", 12, 6, { columns: 8 }),
      item("a", "stat_card", 12, 2),
    ]);
    expect(issues.map((i) => i.rule)).toContain("hierarchy");
  });

  it("respeita o tamanho que o administrador definiu", () => {
    const issues = validateComposition([
      item("a", "bar_chart", 6, 5, { explicit: true }),
      item("b", "pie_chart", 4, 3, { explicit: true }),
    ]);
    expect(issues).toEqual([]);
  });

  it("cita os IDs envolvidos para a IA conseguir corrigir", () => {
    const [issue] = validateComposition([item("a", "bar_chart", 6, 5)]);
    expect(issue?.componentIds).toEqual(["a"]);
    expect(issue?.message).toMatch(/a/);
  });
});

describe("override de layout no commit", () => {
  const doc = {
    ui: {
      components: ["a", "b", "c"].map((id) => ({
        id,
        component: "bar_chart",
        layoutProps: { colSpan: 6, rowSpan: 5 },
        props: { title: id },
      })),
    },
  };

  it("aplica ordem e tamanhos por ID sem tocar no conteúdo", () => {
    const result = applyLayoutOverride(doc, [
      { id: "c", colSpan: 12, rowSpan: 4 },
      { id: "a", colSpan: 6, rowSpan: 5 },
      { id: "b", colSpan: 6, rowSpan: 5 },
    ]);
    expect(result.ui.components.map((c) => c.id)).toEqual(["c", "a", "b"]);
    expect(result.ui.components[0]!.layoutProps).toEqual({
      colSpan: 12,
      rowSpan: 4,
    });
    expect(result.ui.components[0]!.props).toEqual({ title: "c" });
  });

  it("recusa ID que não pertence à proposta", () => {
    expect(() =>
      applyLayoutOverride(doc, [{ id: "x", colSpan: 6, rowSpan: 5 }]),
    ).toThrow(/x/);
  });

  it("recusa tamanho fora de 1 a 12 e IDs repetidos", () => {
    expect(() =>
      applyLayoutOverride(doc, [{ id: "a", colSpan: 13, rowSpan: 5 }]),
    ).toThrow();
    expect(() =>
      applyLayoutOverride(doc, [
        { id: "a", colSpan: 6, rowSpan: 5 },
        { id: "a", colSpan: 6, rowSpan: 5 },
      ]),
    ).toThrow(/repetido/);
  });

  it("mantém no fim os componentes que o override não cita", () => {
    const result = applyLayoutOverride(doc, [
      { id: "b", colSpan: 6, rowSpan: 5 },
    ]);
    expect(result.ui.components.map((c) => c.id)).toEqual(["b", "a", "c"]);
  });
});
