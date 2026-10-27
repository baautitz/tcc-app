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
      series: ["A", "B"],
      data: [
        { mes: "2026-01", A: 3, B: 5 },
        { mes: "2026-02", A: 4 },
      ],
    });
  });
});
