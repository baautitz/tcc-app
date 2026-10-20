import { describe, expect, it } from "vitest";
import { sha256Hex, stableJson } from "./hash.js";
import { assertLive, expireIfStale } from "./lifecycle.js";

describe("hash", () => {
  it("sha256Hex e stableJson são determinísticos", () => {
    expect(sha256Hex("a")).toBe(
      "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
    );
    expect(stableJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(
      '{"a":[2,{"c":2,"d":1}],"b":1}',
    );
  });
});

describe("lifecycle", () => {
  const now = new Date(1000);
  it("assertLive lança só quando expirado", () => {
    expect(() =>
      assertLive(new Date(1001), now, () => new Error("x")),
    ).not.toThrow();
    expect(() => assertLive(new Date(1000), now, () => new Error("x"))).toThrow(
      "x",
    );
  });
  it("expireIfStale executa callback só quando expirado", async () => {
    let n = 0;
    expect(
      await expireIfStale(new Date(2000), now, async () => {
        n++;
      }),
    ).toBe(false);
    expect(
      await expireIfStale(new Date(1000), now, async () => {
        n++;
      }),
    ).toBe(true);
    expect(n).toBe(1);
  });
});
