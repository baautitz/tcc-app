import { describe, expect, it } from "vitest";
import { pivotSeries } from "./lib";

describe("pivotSeries", () => {
  it("agrupa por nome e cria uma série por produto", () => {
    const rows = [
      { mes: "2026-01", produto: "A", qtd: 3 },
      { mes: "2026-01", produto: "B", qtd: 5 },
      { mes: "2026-02", produto: "A", qtd: 4 },
    ];
    expect(pivotSeries(rows, "mes", "qtd", "produto")).toEqual({
      series: [
        { key: "serie:A", label: "A" },
        { key: "serie:B", label: "B" },
      ],
      data: [
        { mes: "2026-01", "serie:A": 3, "serie:B": 5 },
        { mes: "2026-02", "serie:A": 4 },
      ],
    });
  });

  it("série com o mesmo nome do eixo X não sobrescreve o eixo", () => {
    const rows = [
      { mes: "2026-01", produto: "mes", qtd: 3 },
      { mes: "2026-01", produto: "B", qtd: 5 },
    ];
    const { data, series } = pivotSeries(rows, "mes", "qtd", "produto");
    expect(data).toEqual([{ mes: "2026-01", "serie:mes": 3, "serie:B": 5 }]);
    expect(series.map((item) => item.label)).toEqual(["mes", "B"]);
  });

  it("descarta linhas sem nome em vez de criar o ponto 'null'", () => {
    const rows = [
      { mes: null, produto: "A", qtd: 1 },
      { mes: undefined, produto: "A", qtd: 2 },
      { mes: "2026-01", produto: "A", qtd: 3 },
    ];
    expect(pivotSeries(rows, "mes", "qtd", "produto").data).toEqual([
      { mes: "2026-01", "serie:A": 3 },
    ]);
  });
});
