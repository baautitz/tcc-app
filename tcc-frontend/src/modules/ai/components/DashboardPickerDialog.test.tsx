import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardPickerDialog } from "@/modules/ai/components/DashboardPickerDialog";

vi.mock("@/modules/dashboards/api/dashboards.api", () => ({
  dashboardsApi: {
    dashboards: vi.fn(async () => [
      { id: "d-1", name: "Vendas", description: null },
    ]),
    createDashboard: vi.fn(async () => ({ id: "d-new" })),
  },
}));

describe("DashboardPickerDialog", () => {
  it("mostra Selecionar dashboard e devolve a escolha", async () => {
    const onSelect = vi.fn();
    render(
      <DashboardPickerDialog
        open
        busy={false}
        onOpenChange={vi.fn()}
        onSelect={onSelect}
      />,
    );
    expect(screen.queryByText("Abrir dashboard")).toBeNull();
    const buttons = await screen.findAllByRole("button", {
      name: "Selecionar dashboard",
    });
    fireEvent.click(buttons[0]!);
    expect(onSelect).toHaveBeenCalledWith({ id: "d-1", name: "Vendas" });
  });

  it("Novo dashboard cria e já seleciona", async () => {
    const onSelect = vi.fn();
    render(
      <DashboardPickerDialog
        open
        busy={false}
        onOpenChange={vi.fn()}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Novo dashboard/ }),
    );
    fireEvent.change(await screen.findByLabelText("Nome"), {
      target: { value: "Financeiro" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Criar dashboard/ }));
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({
        id: "d-new",
        name: "Financeiro",
      }),
    );
  });
});
