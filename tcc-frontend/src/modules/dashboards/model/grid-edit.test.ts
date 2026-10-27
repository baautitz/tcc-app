import { describe, expect, it } from "vitest";
import {
  applyLayoutToDocument,
  dropIndex,
  moveItem,
  organizeLayout,
  resizeSpans,
  toLayoutOverride,
} from "./grid-edit";
import type { DashboardDocument } from "./types";

const size = (colSpan: number, rowSpan: number) => ({ colSpan, rowSpan });

describe("resizeSpans", () => {
  it("soma as Células puxadas em cada eixo", () => {
    expect(resizeSpans(size(4, 2), 2, -1)).toEqual(size(6, 1));
  });

  it("mantém entre 1 e 12", () => {
    expect(resizeSpans(size(4, 2), 20, 20)).toEqual(size(12, 12));
    expect(resizeSpans(size(4, 2), -10, -10)).toEqual(size(1, 1));
  });
});

describe("dropIndex", () => {
  const others = [size(4, 2), size(4, 2)]; // começam em (linha 1, coluna 1) e (1, 5)

  it("solta no fim quando o alvo vem depois de todos", () => {
    expect(dropIndex(others, 12, 9, 1)).toBe(2);
    expect(dropIndex(others, 12, 1, 2)).toBe(2);
  });

  it("solta no início quando o alvo é a primeira Célula", () => {
    expect(dropIndex(others, 12, 1, 1)).toBe(0);
  });

  it("solta entre dois quando o alvo está entre as posições deles", () => {
    expect(dropIndex(others, 12, 3, 1)).toBe(1);
  });
});

describe("moveItem", () => {
  it("move o item para o índice final, contado sem ele", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(moveItem(list, "a", 2).map((i) => i.id)).toEqual(["b", "c", "a"]);
    expect(moveItem(list, "c", 0).map((i) => i.id)).toEqual(["c", "a", "b"]);
  });
});

describe("applyLayoutToDocument", () => {
  const component = (id: string, colSpan: number) => ({
    id,
    component: "stat_card" as const,
    layoutProps: { colSpan, rowSpan: 2 },
    props: { title: id, queryUuid: "q" },
  });
  const document = {
    id: "d",
    name: "Painel",
    workspace: { params: [] },
    queryBindings: [],
    ui: {
      components: [component("a", 3), component("b", 3), component("c", 3)],
    },
  } as DashboardDocument;

  it("reordena e redimensiona sem tocar no resto do documento", () => {
    const result = applyLayoutToDocument(document, [
      { id: "c", layoutProps: { colSpan: 6, rowSpan: 4 } },
      { id: "a", layoutProps: { colSpan: 3, rowSpan: 2 } },
      { id: "b", layoutProps: { colSpan: 3, rowSpan: 2 } },
    ]);
    expect(result.ui.components.map((c) => c.id)).toEqual(["c", "a", "b"]);
    expect(result.ui.components[0]?.layoutProps).toEqual({
      colSpan: 6,
      rowSpan: 4,
    });
    expect(result.ui.components[0]?.props).toEqual(
      document.ui.components[2]?.props,
    );
    expect(result.name).toBe("Painel");
  });

  it("mantém no fim o que o rascunho não conhece e ignora o que não existe mais", () => {
    const result = applyLayoutToDocument(document, [
      { id: "b", layoutProps: { colSpan: 5, rowSpan: 2 } },
      { id: "removido", layoutProps: { colSpan: 1, rowSpan: 1 } },
    ]);
    expect(result.ui.components.map((c) => c.id)).toEqual(["b", "a", "c"]);
  });
});

describe("toLayoutOverride", () => {
  const item = (id: string, colSpan: number, rowSpan: number) => ({
    id,
    layoutProps: size(colSpan, rowSpan),
  });

  it("lista ordem e tamanhos do rascunho por ID", () => {
    expect(
      toLayoutOverride([item("a", 6, 5), item("b", 6, 5)], [
        item("b", 12, 4),
        item("a", 6, 5),
      ]),
    ).toEqual([
      { id: "b", colSpan: 12, rowSpan: 4 },
      { id: "a", colSpan: 6, rowSpan: 5 },
    ]);
  });

  it("deixa no lugar os componentes que a prévia não mostra", () => {
    const all = [item("a", 6, 5), item("x", 3, 2), item("b", 6, 5)];
    expect(
      toLayoutOverride(all, [item("b", 6, 5), item("a", 6, 5)]).map(
        (entry) => entry.id,
      ),
    ).toEqual(["b", "x", "a"]);
  });

  it("mantém o layout atual dos componentes fora do rascunho", () => {
    const all = [item("a", 6, 5), item("x", 3, 2)];
    expect(toLayoutOverride(all, [item("a", 4, 4)])).toEqual([
      { id: "a", colSpan: 4, rowSpan: 4 },
      { id: "x", colSpan: 3, rowSpan: 2 },
    ]);
  });
});

describe("organizeLayout", () => {
  const item = (id: string, type: string, colSpan: number, rowSpan: number) => ({
    id,
    type,
    layoutProps: size(colSpan, rowSpan),
  });
  const spans = (list: { layoutProps: { colSpan: number } }[]) =>
    list.map((entry) => entry.layoutProps.colSpan);

  it("põe indicadores no topo, gráficos no meio e a tabela por último", () => {
    const result = organizeLayout([
      item("t", "data_table", 12, 6),
      item("b", "bar_chart", 6, 5),
      item("s", "stat_card", 3, 2),
    ]);
    expect(result.map((entry) => entry.id)).toEqual(["s", "b", "t"]);
  });

  it("fecha cada fileira em 12 sem mudar a ordem relativa", () => {
    const result = organizeLayout([
      item("a", "stat_card", 3, 2),
      item("b", "stat_card", 3, 2),
      item("c", "stat_card", 3, 2),
    ]);
    expect(spans(result)).toEqual([4, 4, 4]);
  });

  it("uniformiza a altura da fileira pela maior", () => {
    const result = organizeLayout([
      item("a", "bar_chart", 6, 5),
      item("b", "pie_chart", 6, 3),
    ]);
    expect(result.map((entry) => entry.layoutProps.rowSpan)).toEqual([5, 5]);
  });

  it("deixa a tabela ocupar a fileira inteira", () => {
    const [table] = organizeLayout([item("t", "data_table", 7, 3)]);
    expect(table?.layoutProps.colSpan).toBe(12);
  });

  it("quebra a fileira quando o próximo não cabe", () => {
    const result = organizeLayout([
      item("a", "bar_chart", 8, 5),
      item("b", "bar_chart", 8, 5),
    ]);
    expect(spans(result)).toEqual([12, 12]);
  });
});
