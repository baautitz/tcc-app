import { describe, expect, it } from "vitest";
import { dashboardDocumentSchema } from "../../../shared/lib/contracts.js";
import {
  aiDashboardProposalInputSchema,
  createDashboardDocument,
  dashboardDocumentFingerprint,
  dashboardReferenceFingerprint,
  summarizeDashboardChanges,
} from "./dashboard-proposals.js";

const dashboardId = "00000000-0000-4000-8000-000000000001";
const queryId = "00000000-0000-4000-8000-000000000002";
const addedQueryId = "00000000-0000-4000-8000-000000000003";

describe("contrato da proposta gerada pela IA", () => {
  it("rejeita shape adicional e configuração de layout não suportada", () => {
    const proposal = {
      mode: "create",
      name: "Vendas",
      workspace: { params: [] },
      queryBindings: [],
      components: [
        {
          id: "total",
          component: "stat_card",
          title: "Total de vendas",
          queryUuid: queryId,
          colSpan: 3,
          field: "total",
          rowSpan: 2,
        },
      ],
    };
    expect(() => aiDashboardProposalInputSchema.parse(proposal)).not.toThrow();
    expect(() =>
      aiDashboardProposalInputSchema.parse({ ...proposal, gap: 28 }),
    ).toThrow();
    expect(() =>
      aiDashboardProposalInputSchema.parse({ ...proposal, columns: 12 }),
    ).toThrow();
  });

  it("usa a Grade: tamanho padrão por Tipo, mantido em atualizações", () => {
    const base = { title: "Total", queryUuid: queryId };
    const created = createDashboardDocument(
      aiDashboardProposalInputSchema.parse({
        mode: "create",
        name: "Vendas",
        components: [
          { ...base, id: "kpi", component: "stat_card", field: "total" },
          {
            ...base,
            id: "bars",
            component: "bar_chart",
            nameKey: "mes",
            valueKey: "total",
          },
          {
            ...base,
            id: "table",
            component: "data_table",
            columns: [{ key: "mes" }],
          },
        ],
      }),
      dashboardId,
    );
    expect(created.ui.components.map((c) => c.layoutProps)).toEqual([
      { colSpan: 3, rowSpan: 2 },
      { colSpan: 6, rowSpan: 5 },
      { colSpan: 12, rowSpan: 6 },
    ]);
    const updated = createDashboardDocument(
      aiDashboardProposalInputSchema.parse({
        mode: "update",
        dashboardId,
        name: "Vendas",
        components: [
          { ...base, id: "kpi", component: "stat_card", field: "total" },
        ],
      }),
      dashboardId,
      created,
    );
    expect(updated.ui.components[0]?.layoutProps).toEqual({
      colSpan: 3,
      rowSpan: 2,
    });
    expect(() =>
      aiDashboardProposalInputSchema.parse({
        mode: "create",
        name: "Vendas",
        components: [
          {
            ...base,
            id: "kpi",
            component: "stat_card",
            field: "total",
            colSpan: 13,
          },
        ],
      }),
    ).toThrow();
  });

  it("rejeita dashboard com layout (columns/gap) do formato antigo", () => {
    expect(() =>
      dashboardDocumentSchema.parse({
        id: dashboardId,
        name: "Antigo",
        ui: { layout: { columns: 12, gap: 16 }, components: [] },
      }),
    ).toThrow(/layout/);
    expect(
      dashboardDocumentSchema.parse({ id: dashboardId, name: "Novo" }).ui,
    ).toEqual({ components: [] });
  });

  it("cria documento compatível apenas com UUID de query", () => {
    const input = aiDashboardProposalInputSchema.parse({
      mode: "create",
      name: "Relatório antigo",
      description: "Descrição antiga",
      workspace: { params: [] },
      queryBindings: [],
      components: [
        {
          id: "total",
          component: "stat_card",
          title: "Total de vendas",
          queryUuid: queryId,
          colSpan: 4,
          field: "total",
          format: "currency",
        },
      ],
    });
    const document = createDashboardDocument(input, dashboardId);
    expect(dashboardDocumentSchema.parse(document)).toMatchObject({
      id: dashboardId,
      ui: {
        components: [
          {
            layoutProps: { colSpan: 4, rowSpan: 2 },
            props: { queryUuid: queryId, title: "Total de vendas" },
          },
        ],
      },
    });
    expect(JSON.stringify(document)).not.toContain("sources");
    expect(JSON.stringify(document)).not.toContain("SELECT");
  });

  it("adiciona componente sem remover componentes, filtros e bindings existentes", () => {
    const previous = dashboardDocumentSchema.parse({
      id: dashboardId,
      name: "Fechamento de mês",
      description: "Resumo mensal",
      workspace: {
        params: [
          {
            name: "from_date",
            label: "Data inicial",
            type: "date",
            required: true,
          },
          {
            name: "to_date",
            label: "Data final",
            type: "date",
            required: true,
          },
          {
            name: "categories_focus",
            label: "Categorias",
            type: "multi_select",
            required: false,
          },
        ],
      },
      queryBindings: [
        {
          queryUuid: queryId,
          parameters: { start: { source: "manual", value: "2026-01-01" } },
        },
      ],
      ui: {
        components: [
          {
            id: "old-total",
            component: "stat_card",
            layoutProps: { colSpan: 3 },
            props: {
              title: "Vendas totais",
              queryUuid: queryId,
              field: "total",
            },
          },
        ],
      },
    });
    const input = aiDashboardProposalInputSchema.parse({
      mode: "update",
      dashboardId,
      name: "Fechamento de mês",
      description: "Resumo mensal",
      workspace: { params: [] },
      queryBindings: [
        {
          queryUuid: addedQueryId,
          parameters: {
            start: { source: "context", argument: "from_date" },
            end: { source: "context", argument: "to_date" },
            categories: { source: "context", argument: "categories_focus" },
          },
        },
      ],
      components: [
        {
          id: "sales-by-city",
          component: "data_table",
          title: "Vendas por cidade",
          queryUuid: addedQueryId,
          colSpan: 12,
          columns: [{ key: "cidade" }, { key: "venda_total" }],
        },
      ],
      contextValues: {},
    });

    const next = createDashboardDocument(input, dashboardId, previous);

    expect(next.workspace.params.map(({ name }) => name)).toEqual([
      "from_date",
      "to_date",
      "categories_focus",
    ]);
    expect(next.queryBindings).toHaveLength(2);
    expect(next.queryBindings).toContainEqual(previous.queryBindings[0]);
    expect(
      next.queryBindings.find(({ queryUuid }) => queryUuid === addedQueryId)
        ?.parameters,
    ).toMatchObject({
      start: { source: "context", argument: "from_date" },
      end: { source: "context", argument: "to_date" },
      categories: { source: "context", argument: "categories_focus" },
    });
    expect(next.ui.components.map(({ id }) => id)).toEqual([
      "old-total",
      "sales-by-city",
    ]);
  });

  it("produz fingerprint estável para ordem de chaves e o altera quando query ou servidor mudam", () => {
    const left = {
      id: dashboardId,
      name: "Vendas",
      workspace: { params: [] },
      queryBindings: [],
      ui: { components: [] },
    };
    const right = {
      ui: { components: [] },
      queryBindings: [],
      workspace: { params: [] },
      name: "Vendas",
      id: dashboardId,
    };
    expect(dashboardDocumentFingerprint(left as never)).toBe(
      dashboardDocumentFingerprint(right as never),
    );
    const references = [
      {
        queryId,
        queryUpdatedAt: new Date("2026-09-29T12:00:00Z"),
        dataSourceId: dashboardId,
        sourceUpdatedAt: new Date("2026-09-29T12:00:00Z"),
        sourceTargetHash: "a".repeat(64),
      },
    ];
    expect(dashboardReferenceFingerprint(references)).not.toBe(
      dashboardReferenceFingerprint([
        { ...references[0]!, sourceTargetHash: "b".repeat(64) },
      ]),
    );
    expect(dashboardReferenceFingerprint(references)).not.toBe(
      dashboardReferenceFingerprint([
        { ...references[0]!, queryUpdatedAt: new Date("2026-09-29T12:00:01Z") },
      ]),
    );
  });

  it("resume componentes, filtros e mapeamentos que mudam", () => {
    const previous = dashboardDocumentSchema.parse({
      id: dashboardId,
      name: "Relatório antigo",
      description: "Descrição antiga",
      workspace: {
        params: [
          { name: "from", label: "Data inicial", type: "date", required: true },
        ],
      },
      queryBindings: [
        {
          queryUuid: queryId,
          parameters: { from: { source: "context", argument: "from" } },
        },
      ],
      ui: {
        components: [
          {
            id: "old",
            component: "stat_card",
            layoutProps: { colSpan: 3 },
            props: {
              title: "Total anterior",
              queryUuid: queryId,
              field: "total",
            },
          },
        ],
      },
    });
    const next = dashboardDocumentSchema.parse({
      ...previous,
      name: "Relatório atual",
      description: "Descrição nova",
      workspace: {
        params: [
          { name: "period", label: "Período", type: "text", required: false },
        ],
      },
      queryBindings: [
        {
          queryUuid: queryId,
          parameters: { from: { source: "manual", value: "2026-01-01" } },
        },
      ],
      ui: {
        components: [
          {
            id: "new",
            component: "bar_chart",
            layoutProps: { colSpan: 6 },
            props: {
              title: "Vendas por mês",
              queryUuid: queryId,
              nameKey: "month",
              valueKey: "total",
            },
          },
        ],
      },
    });
    const summary = summarizeDashboardChanges(next, previous);
    expect(summary.join("\n")).toContain(
      "Nome do dashboard: “Relatório antigo” → “Relatório atual”.",
    );
    expect(summary.join("\n")).toContain(
      "Descrição: “Descrição antiga” → “Descrição nova”.",
    );
    expect(summary.join("\n")).toContain(
      "Filtros do dashboard: adicionados: Período (period, text) · removidos: Data inicial (from, date)",
    );
    expect(summary.join("\n")).toContain(
      "Mapeamentos de parâmetros das queries: alterados: 00000000… → from",
    );
    expect(summary.join("\n")).toContain(
      "Componentes: adicionados: Vendas por mês (bar_chart) · removidos: Total anterior (stat_card)",
    );
    expect(summary.join("\n")).not.toContain("2026-01-01");
  });
});
