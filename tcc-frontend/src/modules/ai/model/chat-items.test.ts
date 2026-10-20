import { describe, expect, it } from "vitest";
import {
  insertAfter,
  insertBefore,
  mergePendingContextProposals,
  type ChatItem,
} from "@/modules/ai/model/chat-items";
import { clampWidth, widthForKey } from "@/modules/ai/hooks/useChatResize";
import { chatItemOps } from "@/modules/ai/hooks/useChatSession";
import { runChatStream } from "@/modules/ai/hooks/useChatStream";
import { vi } from "vitest";

const msg = (
  id: string,
  role: "user" | "assistant" = "assistant",
): ChatItem => ({
  id,
  kind: "message",
  role,
  content: "",
  status: "complete",
});
const tool = (id: string) => ({ id, kind: "tool" }) as unknown as ChatItem;

describe("chat-items", () => {
  it("insertBefore puts item before the assistant, or at end if missing", () => {
    expect(
      insertBefore([msg("u", "user"), msg("a")], "a", tool("t")).map(
        (i) => i.id,
      ),
    ).toEqual(["u", "t", "a"]);
    expect(insertBefore([msg("a")], "zz", tool("t")).map((i) => i.id)).toEqual([
      "a",
      "t",
    ]);
  });
  it("insertAfter places item after assistant, before next message", () => {
    const out = insertAfter([msg("a"), msg("u", "user")], "a", tool("t"));
    expect(out.map((i) => i.id)).toEqual(["a", "t", "u"]);
  });
  it("insertAfter appends when no assistant exists", () => {
    expect(insertAfter([], "a", tool("t")).map((i) => i.id)).toEqual(["t"]);
  });
  it("mergePendingContextProposals appends new and refreshes existing", () => {
    const p = (id: string, v: string) => ({ id, v }) as never;
    const cur = [
      { id: "p1", kind: "context_proposal", proposal: p("p1", "old") },
    ] as unknown as ChatItem[];
    const out = mergePendingContextProposals(cur, [
      p("p1", "new"),
      p("p2", "x"),
    ]) as any[];
    expect(out.map((i) => i.id)).toEqual(["p1", "p2"]);
    expect(out[0].proposal.v).toBe("new");
  });
});

describe("resize", () => {
  it("clamps and handles keys", () => {
    expect(clampWidth(10)).toBe(320);
    expect(clampWidth(9999)).toBe(680);
    expect(widthForKey("ArrowLeft", false, 400)).toBe(416);
    expect(widthForKey("ArrowRight", true, 400)).toBe(368);
    expect(widthForKey("Home", false, 400)).toBe(320);
    expect(widthForKey("a", false, 400)).toBeUndefined();
  });
});

describe("chatItemOps", () => {
  it("updateAssistant only touches the matching message", () => {
    let state: ChatItem[] = [msg("a"), msg("b")];
    const ops = chatItemOps((f) => {
      state = typeof f === "function" ? f(state) : f;
    });
    ops.updateAssistant("b", (m) => ({ ...m, content: "x" }));
    expect((state[0] as any).content).toBe("");
    expect((state[1] as any).content).toBe("x");
  });
});

describe("runChatStream", () => {
  it("throws server error message on non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "boom" }),
      }),
    );
    await expect(
      runChatStream({}, new AbortController().signal, () => {}),
    ).rejects.toThrow("boom");
    vi.unstubAllGlobals();
  });
  it("throws when body missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body: null }));
    await expect(
      runChatStream({}, new AbortController().signal, () => {}),
    ).rejects.toThrow("streaming");
    vi.unstubAllGlobals();
  });
});
