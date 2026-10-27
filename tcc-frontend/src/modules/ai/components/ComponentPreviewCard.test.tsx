import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComponentPreviewCard } from "@/modules/ai/components/ComponentPreviewCard";
import type { ComponentPreviewItem } from "@/modules/ai/model/chat-items";
import { aiApi } from "@/modules/ai/api/ai.api";

vi.mock("@/modules/ai/api/ai.api", () => ({
  aiApi: { previewAiComponentReceipt: vi.fn() },
}));
// O gráfico em si não importa aqui: expõe só as linhas recebidas.
vi.mock("@/modules/dashboards/components/DashboardComponentView", () => ({
  DashboardComponentView: ({
    state,
  }: {
    state: { rows?: unknown[]; error?: string };
  }) => (
    <pre data-testid="rows">{JSON.stringify(state.rows ?? state.error)}</pre>
  ),
}));

const query = (value: string) => ({
  rows: [{ value }],
  rowLimit: 50,
  byteLimit: 48_000,
  bytes: 10,
  truncated: false,
  truncationReason: null,
});

const item = {
  id: "r1",
  kind: "component_preview",
  toolCallId: "t1",
  receiptId: "r1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  component: {
    id: "c",
    component: "stat_card",
    title: "Total",
    queryUuid: "q1",
    colSpan: 12,
    field: "value",
  },
  query: query("1"),
  filters: [
    { name: "periodo", label: "Período", type: "text", required: false },
  ],
  bindings: { start: "periodo" },
  contextValues: { periodo: "2017" },
  parameterValues: { seller: "Ana" },
  parameters: [
    {
      name: "start",
      label: "Início",
      type: "text",
      required: true,
      bound: "periodo",
      value: "2017",
    },
    {
      name: "seller",
      label: "Vendedor",
      type: "text",
      required: false,
      bound: null,
      value: "Ana",
    },
  ],
} as unknown as ComponentPreviewItem;

function setup(onApprove = vi.fn()) {
  render(
    <ComponentPreviewCard
      item={item}
      busy={false}
      isLatestInteraction
      onApprove={onApprove}
      onAdjust={vi.fn()}
    />,
  );
  return onApprove;
}

describe("ComponentPreviewCard com filtros do Dashboard ativo", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.mocked(aiApi.previewAiComponentReceipt).mockReset();
  });

  it("mostra os filtros e o input do parâmetro sem filtro, no lugar do bloco de texto", () => {
    setup();
    expect(screen.queryByText("Parâmetros usados nesta prévia")).toBeNull();
    expect(screen.getByPlaceholderText("Período")).toHaveProperty(
      "value",
      "2017",
    );
    expect(screen.getByPlaceholderText("Vendedor")).toHaveProperty(
      "value",
      "Ana",
    );
    // o parâmetro ligado a um filtro não ganha input próprio
    expect(screen.queryByPlaceholderText("Início")).toBeNull();
  });

  it("Aplicar filtros repete a prévia com os valores informados e atualiza o resultado", async () => {
    vi.mocked(aiApi.previewAiComponentReceipt).mockResolvedValue({
      query: query("42"),
    });
    setup();
    expect(screen.getByTestId("rows").textContent).toBe('[{"value":"1"}]');
    fireEvent.change(screen.getByPlaceholderText("Período"), {
      target: { value: "2018" },
    });
    fireEvent.change(screen.getByPlaceholderText("Vendedor"), {
      target: { value: "Bia" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Aplicar filtros/ }));
    await waitFor(() =>
      expect(screen.getByTestId("rows").textContent).toBe('[{"value":"42"}]'),
    );
    expect(aiApi.previewAiComponentReceipt).toHaveBeenCalledWith("r1", {
      contextValues: { periodo: "2018" },
      parameterValues: { seller: "Bia" },
    });
  });

  it("Aprovar envia os valores aplicados, não os editados sem aplicar", async () => {
    vi.mocked(aiApi.previewAiComponentReceipt).mockResolvedValue({
      query: query("42"),
    });
    const onApprove = setup();
    fireEvent.change(screen.getByPlaceholderText("Período"), {
      target: { value: "2018" },
    });
    expect(
      (screen.getByRole("button", { name: "Aprovar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Aplicar filtros/ }));
    await waitFor(() =>
      expect(screen.getByTestId("rows").textContent).toBe('[{"value":"42"}]'),
    );
    fireEvent.click(screen.getByRole("button", { name: "Aprovar" }));
    expect(onApprove).toHaveBeenCalledWith(item, {
      contextValues: { periodo: "2018" },
      parameterValues: { seller: "Ana" },
    });
  });

  it("mostra o erro quando repetir a prévia falha e mantém o resultado anterior", async () => {
    vi.mocked(aiApi.previewAiComponentReceipt).mockRejectedValue(
      new Error("O componente expirou."),
    );
    setup();
    fireEvent.change(screen.getByPlaceholderText("Período"), {
      target: { value: "2018" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Aplicar filtros/ }));
    expect(await screen.findByText("O componente expirou.")).toBeTruthy();
    expect(screen.getByTestId("rows").textContent).toBe('[{"value":"1"}]');
  });
});
