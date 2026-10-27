import { describe, expect, it } from "vitest";
import { previewHeight } from "./preview-size";

describe("previewHeight", () => {
  it("mantém a proporção do tamanho sugerido na largura do chat", () => {
    // 6×5 Células = 800×664 px: razão 0,83.
    expect(previewHeight(300, "bar_chart", { colSpan: 6, rowSpan: 5 })).toBe(249);
  });

  it("não deixa um gráfico estreito virar uma torre", () => {
    expect(previewHeight(257, "bar_chart", { colSpan: 2, rowSpan: 5 })).toBe(380);
  });

  it("indicador fica baixo, no teto de 160 px", () => {
    expect(previewHeight(257, "stat_card", { colSpan: 3, rowSpan: 2 })).toBe(160);
  });

  it("usa o padrão do Tipo sem tamanho sugerido", () => {
    expect(previewHeight(300, "data_table")).toBeGreaterThanOrEqual(220);
  });
});
