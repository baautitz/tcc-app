import { describe, expect, it } from "vitest";
import { expandPlacements, placeComponents } from "./grid-placement";

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

const place = (col: number, row: number, colSpan: number, rowSpan: number) => ({
  col,
  row,
  colSpan,
  rowSpan,
});

describe("expandPlacements", () => {
  it("expande o último componente da fileira até a borda da Grade", () => {
    expect(
      expandPlacements(
        [place(1, 1, 2, 2), place(3, 1, 2, 2), place(5, 1, 4, 2)],
        12,
      ),
    ).toEqual([place(1, 1, 2, 2), place(3, 1, 2, 2), place(5, 1, 8, 2)]);
  });

  it("dá prioridade ao componente que vem antes na lista", () => {
    expect(
      expandPlacements([place(1, 1, 2, 2), place(9, 1, 4, 2)], 12),
    ).toEqual([place(1, 1, 8, 2), place(9, 1, 4, 2)]);
  });

  it("cresce para baixo até a base do layout, sem criar linhas novas", () => {
    expect(
      expandPlacements([place(1, 1, 6, 2), place(7, 1, 6, 4)], 12),
    ).toEqual([place(1, 1, 6, 4), place(7, 1, 6, 4)]);
  });

  it("não cresce se um vizinho ocupa parte do caminho", () => {
    // B (colunas 5-12, linhas 1-2) impede A de crescer à direita; só desce.
    expect(
      expandPlacements(
        [place(1, 1, 4, 6), place(5, 1, 8, 2), place(5, 3, 8, 2)],
        12,
      ),
    ).toEqual([place(1, 1, 4, 6), place(5, 1, 8, 2), place(5, 3, 8, 4)]);
  });

  it("fecha o buraco que sobrava depois do encaixe em ordem de leitura", () => {
    const placed = placeComponents(
      [
        { colSpan: 8, rowSpan: 2 },
        { colSpan: 8, rowSpan: 2 },
        { colSpan: 4, rowSpan: 2 },
      ],
      12,
    );
    expect(expandPlacements(placed, 12)).toEqual([
      place(1, 1, 12, 2),
      place(1, 3, 8, 2),
      place(9, 3, 4, 2),
    ]);
  });
});
