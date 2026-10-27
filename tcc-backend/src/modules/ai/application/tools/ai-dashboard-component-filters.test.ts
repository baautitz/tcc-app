import { describe, expect, it, vi } from "vitest";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { AuthenticatedUser } from "../../../identity/domain/auth-user.js";
import { dashboardDocumentSchema } from "../../../../shared/lib/contracts.js";
import {
  AiDashboardTools,
  type AiDashboardQueryDefinition,
  type AiDashboardToolsRepository,
} from "./ai-dashboard-tools.js";
import type { AiToolProgressEvent } from "./ai-read-tools.js";

const actorId = "00000000-0000-4000-8000-000000000001";
const queryId = "00000000-0000-4000-8000-000000000002";
const sourceId = "00000000-0000-4000-8000-000000000003";
const pageId = "00000000-0000-4000-8000-000000000010";
const componentReceiptId = "00000000-0000-4000-8000-0000000000a1";
const now = Date.parse("2026-10-26T12:00:00.000Z");
const component = {
  id: "monthly-chart",
  component: "bar_chart",
  title: "Faturamento por mês",
  queryUuid: queryId,
  colSpan: 12,
  nameKey: "month_label",
  valueKey: "amount",
};
const admin: AuthenticatedUser = {
  id: actorId,
  name: "Admin",
  email: "admin@test.local",
  isAdmin: true,
  permissions: [],
};
const filteredQuery: AiDashboardQueryDefinition = {
  id: queryId,
  name: "Faturamento mensal",
  dataSourceId: sourceId,
  sqlText: "SELECT month_label, amount FROM public.monthly_sales",
  parameters: [
    { name: "start_date", label: "Data inicial", type: "date", required: true },
    { name: "seller", label: "Vendedor", type: "text", required: false },
  ],
  updatedAt: new Date("2026-09-29T12:00:00.000Z"),
  sourceUpdatedAt: new Date("2026-09-29T12:00:00.000Z"),
  sourceTargetHash: "a".repeat(64),
  connection: {},
};
const dashboardWithFilter = () =>
  dashboardDocumentSchema.parse({
    id: pageId,
    name: "Atual",
    workspace: {
      params: [
        {
          name: "periodo_inicio",
          label: "Início",
          type: "date",
          required: true,
        },
      ],
    },
    queryBindings: [],
    ui: { layout: { gap: 16 }, components: [] },
  });
const rows = {
  rows: [{ month_label: "Setembro", amount: "125.50" }],
  rowLimit: 50,
  byteLimit: 48_000,
  bytes: 48,
  truncated: false,
  truncationReason: null,
};

function repositoryWith(overrides: Partial<AiDashboardToolsRepository> = {}) {
  const repository: AiDashboardToolsRepository = {
    listSavedQueries: vi.fn(async () => []),
    findSavedQueries: vi.fn(async () => [filteredQuery]),
    findDashboard: vi.fn(async () => ({
      document: dashboardWithFilter(),
      fingerprint: "r1",
    })),
    runPreview: vi.fn(async () => rows),
    issueReceipt: vi.fn(async () => true),
    issueComponentReceipt: vi.fn(async () => undefined),
    findComponentReceipt: vi.fn(async () => undefined),
    ...overrides,
  };
  return repository;
}

function toolNamed(
  name: string,
  repository: AiDashboardToolsRepository,
  events: AiToolProgressEvent[] = [],
) {
  return new AiDashboardTools({
    now: () => now,
    currentUser: admin,
    pageDashboardId: pageId,
    repository,
    onToolEvent: (event) => {
      events.push(event);
    },
  })
    .tools()
    .find((candidate) => candidate.name === name)!;
}
const invoke = (tool: StructuredToolInterface, input: unknown) =>
  tool.invoke(input as never, { toolCallId: "call-x" } as never);

describe("filtros do Dashboard ativo no componente isolado", () => {
  it("guarda no Recibo as ligações e entrega ao cartão filtros, ligações e valores", async () => {
    const events: AiToolProgressEvent[] = [];
    const repository = repositoryWith();
    await invoke(toolNamed("preview_component", repository, events), {
      component,
      parameterBindings: { start_date: "periodo_inicio" },
      previewValues: { start_date: "2017-01-01", seller: "Ana" },
    });
    expect(
      vi.mocked(repository.issueComponentReceipt).mock.calls[0]![0],
    ).toMatchObject({
      dashboardId: pageId,
      parameterBindings: { start_date: "periodo_inicio" },
    });
    expect(
      events.find((event) => event.type === "component_preview"),
    ).toMatchObject({
      filters: [{ name: "periodo_inicio", label: "Início", type: "date" }],
      bindings: { start_date: "periodo_inicio" },
      contextValues: { periodo_inicio: "2017-01-01" },
      parameterValues: { seller: "Ana" },
      parameters: [
        { name: "start_date", type: "date", bound: "periodo_inicio" },
        { name: "seller", type: "text", bound: null },
      ],
    });
  });

  it("recusa ligação a filtro que o Dashboard ativo não tem ou a parâmetro que a query não tem", async () => {
    for (const parameterBindings of [
      { start_date: "inexistente" },
      { fantasma: "periodo_inicio" },
    ]) {
      const repository = repositoryWith();
      const output = await invoke(toolNamed("preview_component", repository), {
        component,
        parameterBindings,
      });
      expect(output).toMatchObject({
        ok: false,
        code: "PARAMETER_BINDING_INVALID",
      });
      expect(repository.issueComponentReceipt).not.toHaveBeenCalled();
    }
  });

  it("a proposta usa valores e ligações do Recibo como contextValues e queryBindings", async () => {
    const events: AiToolProgressEvent[] = [];
    const repository = repositoryWith({
      findComponentReceipt: vi.fn(async () => ({
        id: componentReceiptId,
        actorId,
        component,
        expiresAt: new Date(now + 60_000),
        approvedAt: new Date(now - 1_000),
        consumedAt: null,
        dashboardId: pageId,
        parameterBindings: { start_date: "periodo_inicio" },
        contextValues: { periodo_inicio: "2017-01-01", ignorado: "x" },
        parameterValues: { seller: "Ana" },
      })),
    });
    const output = await invoke(
      toolNamed("create_or_update_dashboard", repository, events),
      {
        mode: "update",
        dashboardId: pageId,
        name: "Atual",
        contextValues: {},
        workspace: { params: [] },
        queryBindings: [],
        components: [component],
        componentReceiptId,
        position: { placement: "end" },
      },
    );
    expect(output).toMatchObject({ canCommit: true });
    const preview = events.find((event) => event.type === "dashboard_preview");
    if (preview?.type !== "dashboard_preview") throw new Error("sem prévia");
    expect(preview.document.queryBindings).toEqual([
      {
        queryUuid: queryId,
        parameters: {
          start_date: { source: "context", argument: "periodo_inicio" },
          seller: { source: "manual", value: "Ana" },
        },
      },
    ]);
    expect(preview.contextValues).toEqual({ periodo_inicio: "2017-01-01" });
    expect(vi.mocked(repository.runPreview).mock.calls[0]![1]).toEqual({
      start_date: "2017-01-01",
      seller: "Ana",
    });
  });
});
