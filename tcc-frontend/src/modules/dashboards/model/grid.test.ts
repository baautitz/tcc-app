import { describe, expect, it } from "vitest";
import { gridMetrics } from "./grid";

describe("gridMetrics", () => {
  it("cabe exatamente 12 Células de 80px em 1136px", () => {
    expect(gridMetrics(1136)).toEqual({ columns: 12, cellSize: 80, gap: 16 });
  });

  it("estica as Células mantendo o quadrado quando sobra largura", () => {
    const { columns, cellSize } = gridMetrics(500);
    expect(columns).toBe(5);
    expect(cellSize).toBeCloseTo(87.2, 5);
  });

  it("em tela estreita usa poucas colunas", () => {
    const { columns, cellSize } = gridMetrics(358);
    expect(columns).toBe(3);
    expect(cellSize).toBeCloseTo(108.6667, 3);
  });

  it("limita a 12 colunas e a Célula a 120px em telas largas", () => {
    expect(gridMetrics(2400)).toEqual({ columns: 12, cellSize: 120, gap: 16 });
  });

  it("nunca tem menos de 1 coluna", () => {
    expect(gridMetrics(50).columns).toBe(1);
    expect(gridMetrics(0).columns).toBe(1);
  });
});
