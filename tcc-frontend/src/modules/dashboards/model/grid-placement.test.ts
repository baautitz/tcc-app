import { describe, expect, it } from "vitest";
import { placeComponents } from "./grid-placement";

const item = (colSpan: number, rowSpan: number) => ({ colSpan, rowSpan });

describe("placeComponents", () => {
  it("coloca componentes lado a lado enquanto couberem na linha", () => {
    expect(placeComponents([item(4, 2), item(4, 2), item(4, 2)], 12)).toEqual([
      { col: 1, row: 1, colSpan: 4, rowSpan: 2 },
      { col: 5, row: 1, colSpan: 4, rowSpan: 2 },
      { col: 9, row: 1, colSpan: 4, rowSpan: 2 },
    ]);
  });

  it("empilha quem não cabe ao lado, sem mudar a ordem", () => {
    expect(placeComponents([item(8, 1), item(8, 1)], 12)).toEqual([
      { col: 1, row: 1, colSpan: 8, rowSpan: 1 },
      { col: 1, row: 2, colSpan: 8, rowSpan: 1 },
    ]);
  });

  it("nunca volta para antes do componente anterior na ordem de leitura", () => {
    // O espaço (linha 1, colunas 9-12) sobra, mas C vem depois de B na lista.
    expect(placeComponents([item(8, 1), item(8, 1), item(4, 1)], 12)).toEqual([
      { col: 1, row: 1, colSpan: 8, rowSpan: 1 },
      { col: 1, row: 2, colSpan: 8, rowSpan: 1 },
      { col: 9, row: 2, colSpan: 4, rowSpan: 1 },
    ]);
  });

  it("preenche o espaço ao lado de um componente alto", () => {
    expect(
      placeComponents([item(4, 6), item(8, 2), item(8, 2), item(4, 1)], 12),
    ).toEqual([
      { col: 1, row: 1, colSpan: 4, rowSpan: 6 },
      { col: 5, row: 1, colSpan: 8, rowSpan: 2 },
      { col: 5, row: 3, colSpan: 8, rowSpan: 2 },
      { col: 5, row: 5, colSpan: 4, rowSpan: 1 },
    ]);
  });

  it("limita o colSpan ao número de colunas disponíveis", () => {
    expect(placeComponents([item(8, 5), item(6, 3)], 3)).toEqual([
      { col: 1, row: 1, colSpan: 3, rowSpan: 5 },
      { col: 1, row: 6, colSpan: 3, rowSpan: 3 },
    ]);
  });
});
