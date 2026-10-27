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

import { dashboardsApi } from "@/modules/dashboards/api/dashboards.api";

describe("DashboardPickerDialog", () => {
  it("desabilita Novo dashboard enquanto o chat está ocupado", async () => {
    render(
      <DashboardPickerDialog
        open
        busy
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    const button = await screen.findByRole("button", {
      name: /Novo dashboard/,
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("ao reabrir mostra carregando e, se falhar, não mantém a lista antiga", async () => {
    const view = render(
      <DashboardPickerDialog
        open
        busy={false}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    await screen.findByText("Vendas");
    view.rerender(
      <DashboardPickerDialog
        open={false}
        busy={false}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    vi.mocked(dashboardsApi.dashboards).mockRejectedValueOnce(
      new Error("falhou"),
    );
    view.rerender(
      <DashboardPickerDialog
        open
        busy={false}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(await screen.findByText(/Nenhum dashboard/)).toBeTruthy();
  });

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
