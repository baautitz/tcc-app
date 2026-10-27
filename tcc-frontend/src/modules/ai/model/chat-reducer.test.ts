import { describe, expect, it } from "vitest";
import { applyChatEvent } from "@/modules/ai/model/chat-reducer";
import type { ChatItem } from "@/modules/ai/model/chat-items";
import type { ChatEvent } from "@/modules/ai/model/chat-sse";

const asst: ChatItem = {
  id: "a",
  kind: "message",
  role: "assistant",
  content: "",
  status: "streaming",
};
const ev = (e: unknown) => e as ChatEvent;

describe("applyChatEvent", () => {
  it("token appends content and keeps streaming", () => {
    const out = applyChatEvent([asst], ev({ type: "token", delta: "oi" }), "a");
    expect(out[0]).toMatchObject({ content: "oi", status: "streaming" });
  });
  it("tool_start inserts before assistant; tool_result updates it", () => {
    let out = applyChatEvent(
      [asst],
      ev({ type: "tool_start", toolCallId: "t", toolName: "x" }),
      "a",
    );
    expect(out.map((i) => i.id)).toEqual(["t", "a"]);
    out = applyChatEvent(
      out,
      ev({ type: "tool_result", toolCallId: "t", toolName: "x", ok: false }),
      "a",
    );
    expect(out[0]).toMatchObject({ status: "failed" });
  });
  it("tool_result without start creates the tool before assistant", () => {
    const out = applyChatEvent(
      [asst],
      ev({ type: "tool_result", toolCallId: "t", toolName: "x", ok: true }),
      "a",
    );
    expect(out.map((i) => i.id)).toEqual(["t", "a"]);
    expect(out[0]).toMatchObject({ status: "success" });
  });
  it("proposal is inserted after the assistant", () => {
    const out = applyChatEvent(
      [asst],
      ev({ type: "proposal", proposalId: "p", title: "T", summary: "S" }),
      "a",
    );
    expect(out.map((i) => i.id)).toEqual(["a", "p"]);
  });
  it("error marks assistant and adds error item", () => {
    const out = applyChatEvent(
      [asst],
      ev({ type: "error", message: "boom", retryable: true }),
      "a",
    );
    expect(out[1]).toMatchObject({ status: "error" });
    expect(out[0]).toMatchObject({
      kind: "error",
      message: "boom",
      assistantId: "a",
    });
  });
  it("done completes; unknown events are no-ops", () => {
    expect(applyChatEvent([asst], ev({ type: "done" }), "a")[0]).toMatchObject({
      status: "complete",
    });
    const items = [asst];
    expect(
      applyChatEvent(items, ev({ type: "start", requestId: "r" }), "a"),
    ).toBe(items);
  });
  it("component_preview vira cartão pendente e substitui o anterior ainda indeciso", () => {
    const preview = (receiptId: string) =>
      ev({
        type: "component_preview",
        toolCallId: `call-${receiptId}`,
        receiptId,
        expiresAt: "2099-01-01T00:00:00.000Z",
        component: {
          id: "c",
          component: "bar_chart",
          title: "T",
          queryUuid: "q",
          colSpan: 12,
        },
        query: { rows: [] },
      });
    const asst2: ChatItem = { ...(asst as object), id: "b" } as ChatItem;
    let out = applyChatEvent([asst], preview("r1"), "a");
    out = applyChatEvent([...out, asst2], preview("r2"), "b");
    expect(out.filter((i) => i.kind === "component_preview")).toMatchObject([
      { id: "r1", status: "superseded" },
      { id: "r2" },
    ]);
    expect(out.find((i) => i.id === "r2")).not.toHaveProperty("status");
  });
  it("dashboard_required insere o cartão de seleção depois do assistente", () => {
    const out = applyChatEvent(
      [asst],
      ev({ type: "dashboard_required", toolCallId: "t9" }),
      "a",
    );
    expect(out.map((i) => i.id)).toEqual(["a", "t9"]);
    expect(out[1]).toMatchObject({ kind: "dashboard_required" });
  });
});
