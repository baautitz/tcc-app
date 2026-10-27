import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSend } from "@/modules/ai/hooks/useChatSend";
import { useChatSession } from "@/modules/ai/hooks/useChatSession";
import { runChatStream } from "@/modules/ai/hooks/useChatStream";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("@/shared/context/CurrentViewRefreshContext", () => ({
  useCurrentViewRefresh: () => vi.fn(),
}));
vi.mock("@/modules/ai/hooks/useChatStream", () => ({
  runChatStream: vi.fn(),
}));

function setup(pathname = "/") {
  return renderHook(() => {
    const session = useChatSession();
    return { session, chat: useChatSend(session, pathname) };
  });
}

describe("Dashboard ativo escolhido no chat", () => {
  beforeEach(() => {
    navigate.mockReset();
    vi.mocked(runChatStream).mockReset();
    vi.mocked(runChatStream).mockImplementation(async (_body, _s, onEvent) => {
      onEvent({ version: 1, type: "done" } as never);
      return { receivedDone: true, receivedError: false };
    });
  });

  it("o evento dashboard_required abre o seletor", async () => {
    vi.mocked(runChatStream).mockImplementation(async (_b, _s, onEvent) => {
      onEvent({
        version: 1,
        type: "dashboard_required",
        toolCallId: "t1",
      } as never);
      onEvent({ version: 1, type: "done" } as never);
      return { receivedDone: true, receivedError: false };
    });
    const { result } = setup();
    await act(async () => {
      await result.current.chat.send({ content: "crie um gráfico" });
    });
    expect(result.current.session.dashboardPickerOpen).toBe(true);
  });

  it("selecionar não navega, vira pageContext e dispara a continuação silenciosa", async () => {
    const { result } = setup("/admin/queries");
    act(() => result.current.session.setDashboardPickerOpen(true));
    await act(async () => {
      result.current.chat.selectDashboard({ id: "d-1", name: "Vendas" });
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(result.current.session.dashboardPickerOpen).toBe(false);
    const body = vi.mocked(runChatStream).mock.calls[0]![0] as {
      pageContext: Record<string, string>;
      messages: { role: string; content: string }[];
    };
    expect(body.pageContext).toMatchObject({
      pathname: "/admin/queries",
      dashboardId: "d-1",
      dashboardName: "Vendas",
    });
    expect(body.messages.at(-1)!.content).toMatch(/Vendas/);
    expect(
      result.current.session.items.some(
        (i) => i.kind === "message" && i.role === "user",
      ),
    ).toBe(false);
  });

  it("as próximas mensagens carregam o Dashboard ativo escolhido", async () => {
    const { result } = setup("/admin/queries");
    await act(async () => {
      result.current.chat.selectDashboard({ id: "d-1", name: "Vendas" });
    });
    await act(async () => {
      await result.current.chat.send({ content: "outra coisa" });
    });
    const body = vi.mocked(runChatStream).mock.calls[1]![0] as {
      pageContext: Record<string, string>;
    };
    expect(body.pageContext.dashboardId).toBe("d-1");
  });

  it("selecionar com o chat ocupado mantém o seletor aberto e não fixa o dashboard", async () => {
    vi.mocked(runChatStream).mockImplementation(() => new Promise(() => {}));
    const { result } = setup("/admin/queries");
    await act(async () => {
      void result.current.chat.send({ content: "primeira" });
    });
    act(() => result.current.session.setDashboardPickerOpen(true));
    await act(async () => {
      result.current.chat.selectDashboard({ id: "d-1", name: "Vendas" });
    });
    expect(result.current.session.dashboardPickerOpen).toBe(true);
    expect(vi.mocked(runChatStream)).toHaveBeenCalledTimes(1);
  });
});
