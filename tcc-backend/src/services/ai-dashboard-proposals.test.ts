import { describe, expect, it } from "vitest";
import { dashboardDocumentSchema } from "../lib/contracts.js";
import {
  aiDashboardProposalInputSchema,
  createDashboardDocument,
  dashboardDocumentFingerprint,
  dashboardReferenceFingerprint,
  summarizeDashboardChanges,
} from "./ai-dashboard-proposals.js";

const dashboardId = "00000000-0000-4000-8000-000000000001";
const queryId = "00000000-0000-4000-8000-000000000002";

describe("contrato da proposta gerada pela IA", () => {
  it("rejeita shape adicional e configuração de layout não suportada", () => {
    const proposal = {
      mode: "create",
      name: "Vendas",
      workspace: { params: [] },
      queryBindings: [],
      components: [{
        id: "total",
        component: "stat_card",
        title: "Total de vendas",
        queryUuid: queryId,
        colSpan: 3,
        field: "total",
        rowSpan: 2,
      }],
    };
    expect(() => aiDashboardProposalInputSchema.parse(proposal)).toThrow();
    expect(() => aiDashboardProposalInputSchema.parse({ ...proposal, components: [{ ...proposal.components[0], rowSpan: undefined }] , gap: 28 })).toThrow();
  });

  it("cria documento compatível apenas com UUID de query e gap suportado", () => {
    const input = aiDashboardProposalInputSchema.parse({
      mode: "create",
      name: "Relatório antigo",
      description: "Descrição antiga",
      workspace: { params: [] },
      queryBindings: [],
      components: [{
        id: "total",
        component: "stat_card",
        title: "Total de vendas",
        queryUuid: queryId,
        colSpan: 4,
        field: "total",
        format: "currency",
      }],
    });
    const document = createDashboardDocument(input, dashboardId);
    expect(dashboardDocumentSchema.parse(document)).toMatchObject({
      id: dashboardId,
      ui: { layout: { gap: 16 }, components: [{ layoutProps: { colSpan: 4, rowSpan: 1 }, props: { queryUuid: queryId, title: "Total de vendas" } }] },
    });
    expect(JSON.stringify(document)).not.toContain("sources");
    expect(JSON.stringify(document)).not.toContain("SELECT");
  });

  it("produz fingerprint estável para ordem de chaves e o altera quando query ou servidor mudam", () => {
    const left = { id: dashboardId, name: "Vendas", workspace: { params: [] }, queryBindings: [], ui: { layout: { gap: 16 }, components: [] } };
    const right = { ui: { components: [], layout: { gap: 16 } }, queryBindings: [], workspace: { params: [] }, name: "Vendas", id: dashboardId };
    expect(dashboardDocumentFingerprint(left as never)).toBe(dashboardDocumentFingerprint(right as never));
    const references = [{ queryId, queryUpdatedAt: new Date("2026-09-29T12:00:00Z"), dataSourceId: dashboardId, sourceUpdatedAt: new Date("2026-09-29T12:00:00Z"), sourceTargetHash: "a".repeat(64) }];
    expect(dashboardReferenceFingerprint(references)).not.toBe(dashboardReferenceFingerprint([{ ...references[0]!, sourceTargetHash: "b".repeat(64) }]));
    expect(dashboardReferenceFingerprint(references)).not.toBe(dashboardReferenceFingerprint([{ ...references[0]!, queryUpdatedAt: new Date("2026-09-29T12:00:01Z") }]));
  });

  it("resume componentes, filtros e mapeamentos que mudam", () => {
    const previous = dashboardDocumentSchema.parse({
      id: dashboardId,
      name: "Relatório antigo",
      description: "Descrição antiga",
      workspace: { params: [{ name: "from", label: "Data inicial", type: "date", required: true }] },
      queryBindings: [{ queryUuid: queryId, parameters: { from: { source: "context", argument: "from" } } }],
      ui: { layout: { gap: 16 }, components: [{ id: "old", component: "stat_card", layoutProps: { colSpan: 3 }, props: { title: "Total anterior", queryUuid: queryId, field: "total" } }] },
    });
    const next = dashboardDocumentSchema.parse({
      ...previous,
      name: "Relatório atual",
      description: "Descrição nova",
      workspace: { params: [{ name: "period", label: "Período", type: "text", required: false }] },
      queryBindings: [{ queryUuid: queryId, parameters: { from: { source: "manual", value: "2026-01-01" } } }],
      ui: { layout: { gap: 24 }, components: [{ id: "new", component: "bar_chart", layoutProps: { colSpan: 6 }, props: { title: "Vendas por mês", queryUuid: queryId, nameKey: "month", valueKey: "total" } }] },
    });
    const summary = summarizeDashboardChanges(next, previous);
    expect(summary.join("\n")).toContain("Nome do dashboard: “Relatório antigo” → “Relatório atual”.");
    expect(summary.join("\n")).toContain("Descrição: “Descrição antiga” → “Descrição nova”.");
    expect(summary.join("\n")).toContain("Espaçamento (gap): 16 → 24.");
    expect(summary.join("\n")).toContain("Filtros do dashboard: adicionados: Período (period, text) · removidos: Data inicial (from, date)");
    expect(summary.join("\n")).toContain("Mapeamentos de parâmetros das queries: alterados: 00000000… → from");
    expect(summary.join("\n")).toContain("Componentes: adicionados: Vendas por mês (bar_chart) · removidos: Total anterior (stat_card)");
    expect(summary.join("\n")).not.toContain("2026-01-01");
  });
});
