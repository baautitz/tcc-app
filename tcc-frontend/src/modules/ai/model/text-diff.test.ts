import { describe, expect, it } from "vitest";
import { lineDiff } from "./text-diff";

describe("lineDiff", () => {
  it("marca linhas removidas e adicionadas", () => {
    expect(lineDiff("a\nb\nc", "a\nx\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "x" },
      { kind: "same", text: "c" },
    ]);
  });

  it("textos iguais não têm alterações", () => {
    expect(lineDiff("a\nb", "a\nb").every((line) => line.kind === "same")).toBe(
      true,
    );
  });

  it("trata acréscimo no fim", () => {
    expect(lineDiff("a", "a\nb")).toEqual([
      { kind: "same", text: "a" },
      { kind: "added", text: "b" },
    ]);
  });
});
