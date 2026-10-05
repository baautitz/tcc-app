import { describe, expect, it } from "vitest";
import { applyChatEvent } from "./chat-reducer";
import type { ChatItem } from "./chat-items";
import type { ChatEvent } from "./chat-sse";

const asst: ChatItem = { id: "a", kind: "message", role: "assistant", content: "", status: "streaming" };
const ev = (e: unknown) => e as ChatEvent;

describe("applyChatEvent", () => {
  it("token appends content and keeps streaming", () => {
    const out = applyChatEvent([asst], ev({ type: "token", delta: "oi" }), "a");
    expect(out[0]).toMatchObject({ content: "oi", status: "streaming" });
  });
  it("tool_start inserts before assistant; tool_result updates it", () => {
    let out = applyChatEvent([asst], ev({ type: "tool_start", toolCallId: "t", toolName: "x" }), "a");
    expect(out.map((i) => i.id)).toEqual(["t", "a"]);
    out = applyChatEvent(out, ev({ type: "tool_result", toolCallId: "t", toolName: "x", ok: false }), "a");
    expect(out[0]).toMatchObject({ status: "failed" });
  });
  it("tool_result without start creates the tool before assistant", () => {
    const out = applyChatEvent([asst], ev({ type: "tool_result", toolCallId: "t", toolName: "x", ok: true }), "a");
    expect(out.map((i) => i.id)).toEqual(["t", "a"]);
    expect(out[0]).toMatchObject({ status: "success" });
  });
  it("proposal is inserted after the assistant", () => {
    const out = applyChatEvent([asst], ev({ type: "proposal", proposalId: "p", title: "T", summary: "S" }), "a");
    expect(out.map((i) => i.id)).toEqual(["a", "p"]);
  });
  it("error marks assistant and adds error item", () => {
    const out = applyChatEvent([asst], ev({ type: "error", message: "boom", retryable: true }), "a");
    expect(out[1]).toMatchObject({ status: "error" });
    expect(out[0]).toMatchObject({ kind: "error", message: "boom", assistantId: "a" });
  });
  it("done completes; unknown events are no-ops", () => {
    expect(applyChatEvent([asst], ev({ type: "done" }), "a")[0]).toMatchObject({ status: "complete" });
    const items = [asst];
    expect(applyChatEvent(items, ev({ type: "start", requestId: "r" }), "a")).toBe(items);
  });
});
