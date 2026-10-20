import { describe, expect, it } from "vitest";
import { hasActionCardResult } from "./agent-preflight.js";
import { currentTurn, repairThreadMessages } from "./agent-factory.js";

const ai = (id: string, callId?: string) => ({
  type: "ai",
  id,
  tool_calls: callId ? [{ id: callId, name: "t" }] : [],
});
const tool = (id: string, callId: string, content = "ok") => ({
  type: "tool",
  id,
  tool_call_id: callId,
  content,
});
const human = (id: string) => ({ type: "human", id });

describe("thread maintenance", () => {
  it("scopes QA hooks to the latest turn", () => {
    expect(
      currentTurn([human("1"), ai("a"), human("2"), ai("b")]).map(
        (m) => (m as { id: string }).id,
      ),
    ).toEqual(["2", "b"]);
  });

  it("answers dangling tool calls right after their AI message", () => {
    const repaired = repairThreadMessages([
      human("1"),
      ai("a", "c1"),
      human("2"),
    ])!;
    expect(repaired.map((m) => m.type)).toEqual([
      "human",
      "ai",
      "tool",
      "human",
    ]);
    expect(repaired[2]?.tool_call_id).toBe("c1");
  });

  it("truncates old tool results but not the current turn's", () => {
    const big = "x".repeat(5_000);
    const repaired = repairThreadMessages([
      human("1"),
      ai("a", "c1"),
      tool("t1", "c1", big),
      human("2"),
      ai("b", "c2"),
      tool("t2", "c2", big),
    ])!;
    expect(String(repaired[2]?.content).length).toBeLessThan(2_000);
    expect(repaired[5]?.content).toBe(big);
  });

  it("leaves a healthy thread untouched", () => {
    expect(
      repairThreadMessages([
        human("1"),
        ai("a", "c1"),
        tool("t1", "c1"),
        ai("b"),
      ]),
    ).toBeUndefined();
  });

  it("only counts tool results that produce a card", () => {
    const proposal = {
      type: "tool",
      name: "create_or_update_dashboard",
      content: JSON.stringify({ proposalId: "p" }),
    };
    expect(hasActionCardResult([human("1"), proposal])).toBe(true);
    expect(
      hasActionCardResult([
        human("1"),
        { ...proposal, content: JSON.stringify({ ok: false }) },
      ]),
    ).toBe(false);
    expect(hasActionCardResult([human("1")])).toBe(false);
  });
});
