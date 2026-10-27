import { describe, expect, it } from "vitest";
import { moveItem } from "./moveItem";

describe("moveItem", () => {
  it("move para frente e para trás", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("não altera com índices iguais ou fora do intervalo", () => {
    const items = ["a", "b"];
    expect(moveItem(items, 1, 1)).toBe(items);
    expect(moveItem(items, -1, 0)).toBe(items);
    expect(moveItem(items, 0, 2)).toBe(items);
  });

  it("não muta a lista original", () => {
    const items = ["a", "b", "c"];
    moveItem(items, 0, 2);
    expect(items).toEqual(["a", "b", "c"]);
  });
});
