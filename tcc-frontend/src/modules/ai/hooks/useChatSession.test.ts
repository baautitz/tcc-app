import type { ChatItem } from "@/modules/ai/model/chat-items";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useChatSession } from "@/modules/ai/hooks/useChatSession";

const msg = (id: string, content = "") =>
  ({
    id,
    kind: "message",
    role: "assistant",
    content,
    status: "streaming",
  }) as const;

describe("useChatSession", () => {
  it("começa vazio e atualiza draft/busy/progress", () => {
    const { result } = renderHook(() => useChatSession());
    expect(result.current.items).toEqual([]);
    expect(result.current.draft).toBe("");
    expect(result.current.busy).toBe(false);
    act(() => {
      result.current.setDraft("oi");
      result.current.setBusy(true);
      result.current.setActivityProgress("x");
    });
    expect(result.current).toMatchObject({
      draft: "oi",
      busy: true,
      activityProgress: "x",
    });
  });

  it("ops atualizam apenas a mensagem do assistente e mantêm identidade estável", () => {
    const { result, rerender } = renderHook(() => useChatSession());
    const first = result.current.updateAssistant;
    act(() => result.current.setItems([msg("a"), msg("b")]));
    act(() =>
      result.current.updateAssistant("a", (m) => ({ ...m, content: "novo" })),
    );
    expect((result.current.items[0] as { content: string }).content).toBe(
      "novo",
    );
    expect((result.current.items[1] as { content: string }).content).toBe("");
    rerender();
    expect(result.current.updateAssistant).toBe(first);
  });

  it("insertBefore/AfterAssistant posicionam itens", () => {
    const { result } = renderHook(() => useChatSession());
    act(() => result.current.setItems([msg("a")]));
    act(() =>
      result.current.insertBeforeAssistant("a", {
        id: "t1",
        kind: "tool",
      } as unknown as ChatItem),
    );
    act(() =>
      result.current.insertAfterAssistant("a", {
        id: "t2",
        kind: "tool",
      } as unknown as ChatItem),
    );
    expect(result.current.items.map((i) => i.id)).toEqual(["t1", "a", "t2"]);
  });
});
