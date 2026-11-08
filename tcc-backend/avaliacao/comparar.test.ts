import { describe, expect, it } from "vitest";
import { compararResultados, normalizarValor } from "./comparar.js";

describe("normalizarValor", () => {
  it("trata numeric do pg (texto) e number como o mesmo valor", () => {
    expect(normalizarValor("13591643.70")).toBe(normalizarValor(13591643.7));
    expect(normalizarValor("99441")).toBe(normalizarValor(99441));
  });
  it("reduz timestamp e mês textual ao primeiro dia do mês", () => {
    expect(normalizarValor("2017-01-01T00:00:00.000Z")).toBe("2017-01-01");
    expect(normalizarValor("2017-01")).toBe("2017-01-01");
    expect(normalizarValor("01/2017")).toBe("2017-01-01");
    expect(normalizarValor("15/03/2017")).toBe("2017-03-15");
    expect(normalizarValor(new Date("2017-01-01T00:00:00Z"))).toBe(
      "2017-01-01",
    );
  });
});

describe("compararResultados", () => {
  const gold = [
    { mes: "2017-01", pedidos: 800 },
    { mes: "2017-02", pedidos: 1780 },
  ];
  it("aceita outros nomes de coluna e colunas extras", () => {
    const gerado = [
      { m: "2017-01-01T00:00:00.000Z", total: "800", extra: 1 },
      { m: "2017-02-01T00:00:00.000Z", total: "1780", extra: 2 },
    ];
    expect(
      compararResultados(gold, gerado, ["mes", "pedidos"], true).igual,
    ).toBe(true);
  });
  it("ignora a ordem das linhas quando não é exigida, mas não quando é", () => {
    const invertido = [
      { a: "2017-02", b: 1780 },
      { a: "2017-01", b: 800 },
    ];
    expect(
      compararResultados(gold, invertido, ["mes", "pedidos"], false).igual,
    ).toBe(true);
    expect(
      compararResultados(gold, invertido, ["mes", "pedidos"], true).igual,
    ).toBe(false);
  });
  it("reprova valor diferente e número de linhas diferente", () => {
    expect(
      compararResultados(
        gold,
        [
          { a: "2017-01", b: 801 },
          { a: "2017-02", b: 1780 },
        ],
        ["mes", "pedidos"],
        true,
      ).igual,
    ).toBe(false);
    expect(
      compararResultados(
        gold,
        [{ a: "2017-01", b: 800 }],
        ["mes", "pedidos"],
        true,
      ).igual,
    ).toBe(false);
  });
  it("não confunde pares de colunas desalinhados", () => {
    const cruzado = [
      { a: "2017-01", b: 1780 },
      { a: "2017-02", b: 800 },
    ];
    expect(
      compararResultados(gold, cruzado, ["mes", "pedidos"], false).igual,
    ).toBe(false);
  });
});
