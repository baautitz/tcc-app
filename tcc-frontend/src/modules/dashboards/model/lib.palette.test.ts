import { describe, expect, it } from "vitest";
import { colors } from "./lib";

describe("paleta dos gráficos", () => {
  it("é a fonte única de 10 cores --chart-1..10", () => {
    expect(colors).toEqual(
      Array.from({ length: 10 }, (_, index) => `var(--chart-${index + 1})`),
    );
  });
});
