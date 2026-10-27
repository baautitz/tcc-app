import { describe, expect, it } from "vitest";
import { suggestComponentSize } from "./composition.js";

const rows = (count: number, columns = 2) =>
  Array.from({ length: count }, (_, index) =>
    Object.fromEntries(
      Array.from({ length: columns }, (__, column) => [
        `c${column}`,
        column === 0 ? `Item ${index}` : index,
      ]),
    ),
  );

describe("tamanho sugerido do componente isolado", () => {
  it("indicador fica compacto", () => {
    expect(
      suggestComponentSize({ component: "stat_card" }, rows(1)),
    ).toEqual({ colSpan: 3, rowSpan: 2 });
  });

  it("tabela com muitas colunas ocupa a fileira inteira", () => {
    expect(
      suggestComponentSize(
        {
          component: "data_table",
          columns: Array.from({ length: 9 }, (_, i) => ({ key: `c${i}` })),
        },
        rows(20, 9),
      ),
    ).toMatchObject({ colSpan: 12 });
  });

  it("gráfico de barras com muitas categorias fica mais largo", () => {
    expect(
      suggestComponentSize(
        { component: "bar_chart", nameKey: "c0" },
        rows(15),
      ).colSpan,
    ).toBeGreaterThanOrEqual(8);
  });

  it("respeita o tamanho que o administrador pediu", () => {
    expect(
      suggestComponentSize(
        { component: "bar_chart", nameKey: "c0", colSpan: 4, rowSpan: 3 },
        rows(15),
      ),
    ).toEqual({ colSpan: 4, rowSpan: 3 });
  });
});
