import { describe, expect, it } from "vitest";
import { gridMetrics, gridWidth } from "./grid";

describe("gridMetrics", () => {
  it("cabe exatamente 12 Células de 120px em 1616px", () => {
    expect(gridMetrics(1616)).toEqual({ columns: 12, cellSize: 120, gap: 16 });
  });

  it("mantém a Célula em 120px e só muda o número de colunas", () => {
    expect(gridMetrics(500)).toEqual({ columns: 3, cellSize: 120, gap: 16 });
    expect(gridMetrics(358)).toEqual({ columns: 2, cellSize: 120, gap: 16 });
    expect(gridMetrics(1615)).toEqual({ columns: 11, cellSize: 120, gap: 16 });
  });

  it("limita a 12 colunas em telas largas, sem esticar a Célula", () => {
    expect(gridMetrics(2400)).toEqual({ columns: 12, cellSize: 120, gap: 16 });
  });

  it("nunca tem menos de 1 coluna", () => {
    expect(gridMetrics(50).columns).toBe(1);
    expect(gridMetrics(0).columns).toBe(1);
  });
});

describe("gridWidth", () => {
  it("é a largura ocupada pelas colunas e pelos gaps", () => {
    expect(gridWidth(gridMetrics(2400))).toBe(1616);
    expect(gridWidth(gridMetrics(500))).toBe(392);
    expect(gridWidth(gridMetrics(0))).toBe(120);
  });

  it("é estável: medir a própria largura devolve as mesmas colunas", () => {
    for (const width of [120, 392, 800, 1616]) {
      const metrics = gridMetrics(width);
      expect(gridMetrics(gridWidth(metrics)).columns).toBe(metrics.columns);
    }
  });
});
