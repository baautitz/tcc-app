import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentPreviewItem } from "@/modules/ai/model/chat-items";
import { useChatSend } from "@/modules/ai/hooks/useChatSend";
import { useChatSession } from "@/modules/ai/hooks/useChatSession";
import { runChatStream } from "@/modules/ai/hooks/useChatStream";

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/shared/context/CurrentViewRefreshContext", () => ({
  useCurrentViewRefresh: () => vi.fn(),
}));
vi.mock("@/modules/ai/hooks/useChatStream", () => ({
  runChatStream: vi.fn(),
}));

const card = {
  id: "card-1",
  kind: "component_preview",
  toolCallId: "t1",
  receiptId: "r1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  component: { id: "c", component: "bar_chart", title: "Vendas", colSpan: 12 },
  query: { rows: [] },
} as unknown as ComponentPreviewItem;

function setup() {
  return renderHook(() => {
    const session = useChatSession();
    return { session, chat: useChatSend(session, "/dashboards") };
  });
}
const statusOf = (items: unknown[]) =>
  (
    items.find((i) => (i as { id: string }).id === "card-1") as
      ComponentPreviewItem | undefined
  )?.status;

describe("useChatSend.adjustComponent", () => {
  beforeEach(() => {
    vi.mocked(runChatStream).mockReset();
  });

  it("devolve o cartão ao estado inicial quando o envio falha", async () => {
    vi.mocked(runChatStream).mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    const { result } = setup();
    act(() => result.current.session.setItems([card]));
    await act(async () => {
      await result.current.chat.adjustComponent(card, { title: "Novo" });
    });
    expect(statusOf(result.current.session.items)).toBeUndefined();
  });

  it("devolve o cartão ao estado inicial quando o envio é abortado", async () => {
    vi.mocked(runChatStream).mockImplementation(async () => {
      throw new DOMException("abort", "AbortError");
    });
    const { result } = setup();
    act(() => result.current.session.setItems([card]));
    await act(async () => {
      await result.current.chat.adjustComponent(card, { title: "Novo" });
    });
    expect(statusOf(result.current.session.items)).toBeUndefined();
  });
});
