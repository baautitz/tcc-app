import { describe, expect, it } from "vitest";
import { dashboardComponentTypes } from "../../../shared/lib/contracts.js";
import {
  aiComponentTypesAreComplete,
  aiDashboardProposalInputSchema,
} from "./dashboard-proposals.js";
import { validateDashboardPreviewFields } from "./dashboard-preview-validation.js";
import type { DashboardDocument } from "./dashboards.js";

const queryUuid = "00000000-0000-4000-8000-000000000002";
const line = {
  id: "timeline",
  component: "line_chart",
  title: "Linha do tempo",
  queryUuid,
  nameKey: "mes",
  valueKey: "quantidade",
};
const proposal = (component: Record<string, unknown>) => ({
  mode: "create",
  name: "Vendas",
  components: [component],
});

describe("line_chart na proposta da IA", () => {
  it("aceita com e sem seriesKey", () => {
    expect(
      aiDashboardProposalInputSchema.safeParse(proposal(line)).success,
    ).toBe(true);
    expect(
      aiDashboardProposalInputSchema.safeParse(
        proposal({ ...line, seriesKey: "produto" }),
      ).success,
    ).toBe(true);
  });

  it("cobre todos os tipos do contrato do dashboard", () => {
    expect(aiComponentTypesAreComplete).toBe(true);
    for (const type of dashboardComponentTypes)
      expect(type).toMatch(/^[a-z_]+$/);
  });
});

describe("validação de preview do line_chart", () => {
  const documentWith = (props: Record<string, unknown>) =>
    ({
      workspace: { params: [] },
      ui: {
        components: [
          {
            id: "timeline",
            component: "line_chart",
            props: { ...props, title: "t", queryUuid },
          },
        ],
      },
    }) as unknown as DashboardDocument;
  const rows = {
    [queryUuid]: {
      rows: [{ mes: "2026-01", produto: "A", quantidade: 3 }],
      rowLimit: 500,
      byteLimit: 48000,
      bytes: 10,
      truncated: false,
      truncationReason: null,
    },
  };

  it("passa com aliases válidos e rejeita série inexistente", () => {
    const base = { nameKey: "mes", valueKey: "quantidade" };
    expect(
      validateDashboardPreviewFields(
        documentWith({ ...base, seriesKey: "produto" }),
        rows,
      ),
    ).toEqual([]);
    expect(
      validateDashboardPreviewFields(
        documentWith({ ...base, seriesKey: "nao_existe" }),
        rows,
      ).join(" "),
    ).toContain("como série");
  });
});
