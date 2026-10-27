import { describe, expect, it } from "vitest";
import { gridMetrics } from "./grid";

describe("gridMetrics", () => {
  it("cabe exatamente 12 Células de 80px em 1136px", () => {
    expect(gridMetrics(1136)).toEqual({ columns: 12, cellSize: 80, gap: 16 });
  });

  it("mantém a Célula em 80px e só muda o número de colunas", () => {
    expect(gridMetrics(500)).toEqual({ columns: 5, cellSize: 80, gap: 16 });
    expect(gridMetrics(358)).toEqual({ columns: 3, cellSize: 80, gap: 16 });
    expect(gridMetrics(1135)).toEqual({ columns: 11, cellSize: 80, gap: 16 });
  });

  it("limita a 12 colunas em telas largas, sem esticar a Célula", () => {
    expect(gridMetrics(2400)).toEqual({ columns: 12, cellSize: 80, gap: 16 });
  });

  it("nunca tem menos de 1 coluna", () => {
    expect(gridMetrics(50).columns).toBe(1);
    expect(gridMetrics(0).columns).toBe(1);
  });
});
