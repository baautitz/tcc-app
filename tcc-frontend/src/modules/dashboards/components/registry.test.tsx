import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DashboardComponent } from "@/modules/dashboards/model/types";
import { DashboardComponentView } from "./DashboardComponentView";
import { DataTableRenderer } from "./DataTableRenderer";
import { rendererFor } from "./registry";

vi.mock("recharts", async (orig) => {
  const actual = await orig<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => (
      <div style={{ width: 400, height: 300 }}>{children}</div>
    ),
  };
});

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const make = (type: string): DashboardComponent =>
  ({
    id: "c1",
    type,
    title: "Titulo X",
    queryUuid: "q1",
    layoutProps: { colSpan: 6, rowSpan: 1 },
    props: {},
  }) as DashboardComponent;
const rows = [
  { nome: "A", total: 3 },
  { nome: "B", total: 5 },
];

describe("registry de renderers", () => {
  it.each(["stat_card", "bar_chart", "line_chart", "pie_chart", "data_table"])(
    "%s renderiza com dados mínimos",
    (type) => {
      const { container } = render(
        <DashboardComponentView
          component={make(type)}
          state={{ loading: false, rows }}
        />,
      );
      expect(screen.getByText("Titulo X")).toBeTruthy();
      expect(container.firstChild).not.toBeNull();
    },
  );

  it("tipo desconhecido usa o fallback de tabela", () => {
    expect(rendererFor("nao_existe")).toBe(DataTableRenderer);
    render(
      <DashboardComponentView
        component={make("nao_existe")}
        state={{ loading: false, rows }}
      />,
    );
    expect(screen.getByText("Titulo X")).toBeTruthy();
    expect(screen.getByText("B")).toBeTruthy();
  });

  it("sem linhas mostra mensagem vazia", () => {
    render(
      <DashboardComponentView
        component={make("stat_card")}
        state={{ loading: false, rows: [] }}
      />,
    );
    expect(screen.getByText("Nenhum dado retornado.")).toBeTruthy();
  });
});

afterEach(cleanup);
