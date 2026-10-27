import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../../../identity/domain/auth-user.js";
import { dashboardDocumentSchema } from "../../../../shared/lib/contracts.js";
import {
  AiDashboardTools,
  type AiDashboardQueryDefinition,
  type AiDashboardToolsRepository,
} from "./ai-dashboard-tools.js";

const createAiDashboardTools = (
  options: ConstructorParameters<typeof AiDashboardTools>[0],
) => new AiDashboardTools({ now: () => now, ...options }).tools();
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { AiToolProgressEvent } from "./ai-read-tools.js";

const actorId = "00000000-0000-4000-8000-000000000001";
const queryId = "00000000-0000-4000-8000-000000000002";
const sourceId = "00000000-0000-4000-8000-000000000003";
const componentReceiptId = "00000000-0000-4000-8000-0000000000a1";
const approvedComponent = {
  id: "monthly-chart",
  component: "bar_chart",
  title: "Faturamento por mês",
  queryUuid: queryId,
  colSpan: 12,
  nameKey: "month_label",
  valueKey: "amount",
};
const now = Date.parse("2026-10-26T12:00:00.000Z");
const validReceipt = {
  id: componentReceiptId,
  actorId,
  component: approvedComponent,
  expiresAt: new Date(now + 60_000),
  approvedAt: new Date(now - 1_000),
  consumedAt: null,
};

const admin: AuthenticatedUser = {
  id: actorId,
  name: "Admin",
  email: "admin@test.local",
  isAdmin: true,
  permissions: [],
};
const savedQuery: AiDashboardQueryDefinition = {
  id: queryId,
  name: "Faturamento mensal",
  dataSourceId: sourceId,
  sqlText: "SELECT month_label, amount FROM public.monthly_sales",
  parameters: [],
  updatedAt: new Date("2026-09-29T12:00:00.000Z"),
  sourceUpdatedAt: new Date("2026-09-29T12:00:00.000Z"),
  sourceTargetHash: "a".repeat(64),
  connection: {},
};

function makeRepository(overrides: Partial<AiDashboardToolsRepository> = {}) {
  const repository: AiDashboardToolsRepository = {
    listSavedQueries: vi.fn(async () => [savedQuery]),
    findSavedQueries: vi.fn(async (ids: string[]) =>
      ids.includes(queryId) ? [savedQuery] : [],
    ),
    findDashboard: vi.fn(async () => undefined),
    runPreview: vi.fn(async () => ({
      rows: [{ month_label: "Setembro", amount: "125.50" }],
      rowLimit: 50,
      byteLimit: 48_000,
      bytes: 48,
      truncated: false,
      truncationReason: null,
    })),
    issueReceipt: vi.fn(async () => undefined),
    issueComponentReceipt: vi.fn(async () => undefined),
    findComponentReceipt: vi.fn(async () => validReceipt),
    consumeComponentReceipt: vi.fn(async () => true),
    ...overrides,
  };
  return repository;
}

function validProposal() {
  return {
    mode: "create",
    name: "Faturamento mensal",
    description: "Evolução de vendas por mês",
    gap: 16,
    workspace: { params: [] },
    queryBindings: [],
    components: [
      {
        id: "monthly-chart",
        component: "bar_chart",
        title: "Faturamento por mês",
        queryUuid: queryId,
        colSpan: 12,
        nameKey: "month_label",
        valueKey: "amount",
      },
    ],
    contextValues: {},
    componentReceiptId,
    destination: { kind: "new_dashboard" },
    position: { placement: "end" },
  };
}

function eventFrom(events: AiToolProgressEvent[], type: "dashboard_preview") {
  const event = events.find((candidate) => candidate.type === type);
  if (!event || event.type !== type) throw new Error(`${type} event missing`);
  return event;
}

describe("propostas de dashboard da IA", () => {
  it("retorna os filtros reais e pede decisão de período só quando existe filtro de data", async () => {
    const dashboardId = "00000000-0000-4000-8000-000000000010";
    const currentDocument = dashboardDocumentSchema.parse({
      id: dashboardId,
      name: "Fechamento de mês",
      workspace: {
        params: [
          {
            name: "from_date",
            label: "Data inicial",
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
      queryBindings: [],
      ui: { layout: { gap: 16 }, components: [] },
    });
    const tools = createAiDashboardTools({
      currentUser: admin,
      repository: makeRepository({
        findDashboard: vi.fn(async () => ({
          document: currentDocument,
          fingerprint: "revision-1",
        })),
      }),
      pageDashboardId: dashboardId,
    });
    const tool = tools.find(
      (candidate) => candidate.name === "get_current_dashboard",
    )!;
    const output = await tool.invoke({} as never);

    expect(output).toMatchObject({
      dashboardId,
      filters: [
        {
          name: "from_date",
          label: "Data inicial",
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
      filterDecision: {
        hasDateFilter: true,
        dateFilters: [{ name: "from_date", label: "Data inicial" }],
      },
    });
    expect(JSON.stringify(output)).toContain("Data inicial");
    expect(JSON.stringify(output)).toContain("período específico");
  });

  it("não pergunta sobre período quando o dashboard só tem filtro de categoria", async () => {
    const dashboardId = "00000000-0000-4000-8000-000000000010";
    const currentDocument = dashboardDocumentSchema.parse({
      id: dashboardId,
      name: "Fechamento de mês",
      workspace: {
        params: [
          {
            name: "categories_focus",
            label: "Categorias",
            type: "multi_select",
            required: false,
          },
        ],
      },
      queryBindings: [],
      ui: { layout: { gap: 16 }, components: [] },
    });
    const tools = createAiDashboardTools({
      currentUser: admin,
      repository: makeRepository({
        findDashboard: vi.fn(async () => ({
          document: currentDocument,
          fingerprint: "revision-1",
        })),
      }),
      pageDashboardId: dashboardId,
    });
    const tool = tools.find(
      (candidate) => candidate.name === "get_current_dashboard",
    )!;
    const output = await tool.invoke({} as never);

    expect(output).toMatchObject({ filterDecision: { hasDateFilter: false } });
    expect(JSON.stringify(output)).toContain("não tem filtro de data");
    expect(JSON.stringify(output)).not.toContain("período específico");
  });

  it("gera prévia com query UUID salva e cria apenas recibo temporário", async () => {
    const events: AiToolProgressEvent[] = [];
    const issueReceipt = vi.fn(
      async (
        _input: Parameters<AiDashboardToolsRepository["issueReceipt"]>[0],
      ) => undefined,
    );
    const repository = makeRepository({ issueReceipt });
    const tools = createAiDashboardTools({
      currentUser: admin,
      repository,
      onToolEvent: (event) => {
        events.push(event);
      },
    });
    const tool = tools.find(
      (candidate) => candidate.name === "create_or_update_dashboard",
    )!;
    const output = await tool.invoke(
      validProposal() as never,
      { toolCallId: "call-1" } as never,
    );
    const preview = eventFrom(events, "dashboard_preview");

    expect(preview).toMatchObject({
      toolCallId: "call-1",
      canCommit: true,
      mode: "create",
      document: { name: "Faturamento mensal" },
      queries: {
        [queryId]: { rows: [{ month_label: "Setembro", amount: "125.50" }] },
      },
    });
    expect(preview.document.id).not.toBe(queryId);
    expect(repository.findSavedQueries).toHaveBeenCalledWith([queryId]);
    expect(repository.runPreview).toHaveBeenCalledOnce();
    expect(issueReceipt).toHaveBeenCalledOnce();
    expect(JSON.stringify(issueReceipt.mock.calls[0]?.[0])).not.toContain(
      "125.50",
    );
    expect(output).toBeDefined();
    expect(events.map((event) => event.type)).toEqual([
      "tool_start",
      "dashboard_preview",
      "tool_result",
    ]);
  });

  it("não emite recibo nem permite commit quando query falha ou retorna vazio", async () => {
    const events: AiToolProgressEvent[] = [];
    const repository = makeRepository({
      runPreview: vi.fn(async () => ({
        rows: [],
        rowLimit: 50,
        byteLimit: 48_000,
        bytes: 0,
        truncated: false,
        truncationReason: null,
      })),
    });
    const tools = createAiDashboardTools({
      currentUser: admin,
      repository,
      onToolEvent: (event) => {
        events.push(event);
      },
    });
    const tool = tools.find(
      (candidate) => candidate.name === "create_or_update_dashboard",
    )!;
    await tool.invoke(
      validProposal() as never,
      { toolCallId: "call-2" } as never,
    );
    expect(eventFrom(events, "dashboard_preview")).toMatchObject({
      canCommit: false,
    });
    expect(repository.issueReceipt).not.toHaveBeenCalled();
  });

  it("recusa um recibo de query usado como referência que não está no catálogo salvo", async () => {
    const receiptId = "00000000-0000-4000-8000-000000000099";
    const repository = makeRepository({
      findSavedQueries: vi.fn(async () => []),
      findComponentReceipt: vi.fn(async () => ({
        ...validReceipt,
        component: { ...approvedComponent, queryUuid: receiptId },
      })),
    });
    const tools = createAiDashboardTools({ currentUser: admin, repository });
    const tool = tools.find(
      (candidate) => candidate.name === "create_or_update_dashboard",
    )!;
    const proposal = validProposal();
    proposal.components[0]!.queryUuid = receiptId;
    await expect(
      tool.invoke(proposal as never, { toolCallId: "call-3" } as never),
    ).rejects.toThrow("queries salvas");
    expect(repository.issueReceipt).not.toHaveBeenCalled();
  });

  it("exige administrador ao construir ferramentas", () => {
    expect(() =>
      createAiDashboardTools({
        currentUser: { ...admin, isAdmin: false },
        repository: makeRepository(),
      }),
    ).toThrow("administradores");
  });
});

describe("fases da IA: Recibo de componente, destino e posição", () => {
  const proposeTool = (
    repository: AiDashboardToolsRepository,
    extra: Partial<ConstructorParameters<typeof AiDashboardTools>[0]> = {},
  ) =>
    createAiDashboardTools({ currentUser: admin, repository, ...extra }).find(
      (candidate) => candidate.name === "create_or_update_dashboard",
    )!;
  const invoke = (tool: StructuredToolInterface, input: unknown) =>
    tool.invoke(input as never, { toolCallId: "call-x" } as never);

  it("recusa sem Recibo de componente", async () => {
    const repository = makeRepository();
    const { componentReceiptId: _omit, ...proposal } = validProposal();
    const output = await invoke(proposeTool(repository), proposal);
    expect(output).toMatchObject({
      ok: false,
      code: "COMPONENT_RECEIPT_REQUIRED",
    });
    expect(repository.issueReceipt).not.toHaveBeenCalled();
  });

  it("recusa sem destino declarado", async () => {
    const repository = makeRepository();
    const { destination: _omit, ...proposal } = validProposal();
    const output = await invoke(proposeTool(repository), proposal);
    expect(output).toMatchObject({ ok: false, code: "DESTINATION_REQUIRED" });
    expect(repository.consumeComponentReceipt).not.toHaveBeenCalled();
  });

  it("recusa sem posição declarada", async () => {
    const repository = makeRepository();
    const { position: _omit, ...proposal } = validProposal();
    const output = await invoke(proposeTool(repository), proposal);
    expect(output).toMatchObject({ ok: false, code: "POSITION_REQUIRED" });
    expect(repository.issueReceipt).not.toHaveBeenCalled();
  });

  it("no contexto de um dashboard o destino vale pelo contexto, mas a posição não", async () => {
    const dashboardId = "00000000-0000-4000-8000-000000000010";
    const current = dashboardDocumentSchema.parse({
      id: dashboardId,
      name: "Atual",
      workspace: { params: [] },
      queryBindings: [],
      ui: { layout: { gap: 16 }, components: [] },
    });
    const repository = makeRepository({
      findDashboard: vi.fn(async () => ({
        document: current,
        fingerprint: "r1",
      })),
    });
    const { destination: _d, position: _p, ...base } = validProposal();
    const update = { ...base, mode: "update", dashboardId };
    const tool = proposeTool(repository, { pageDashboardId: dashboardId });
    expect(await invoke(tool, update)).toMatchObject({
      ok: false,
      code: "POSITION_REQUIRED",
    });
    const output = await invoke(tool, {
      ...update,
      position: { placement: "start" },
    });
    expect(output).toMatchObject({ canCommit: true, dashboardId });
  });

  it("recusa Recibo de outro Ator", async () => {
    const repository = makeRepository({
      findComponentReceipt: vi.fn(async () => ({
        ...validReceipt,
        actorId: "00000000-0000-4000-8000-0000000000ff",
      })),
    });
    const output = await invoke(proposeTool(repository), validProposal());
    expect(output).toMatchObject({
      ok: false,
      code: "COMPONENT_RECEIPT_INVALID",
    });
    expect(repository.issueReceipt).not.toHaveBeenCalled();
  });

  it("recusa Recibo já usado, não aprovado, expirado ou de outro componente", async () => {
    for (const patch of [
      { consumedAt: new Date(now - 5) },
      { approvedAt: null },
      { expiresAt: new Date(now - 1) },
      { component: { ...approvedComponent, component: "pie_chart" } },
    ]) {
      const repository = makeRepository({
        findComponentReceipt: vi.fn(async () => ({
          ...validReceipt,
          ...patch,
        })),
      });
      const output = await invoke(proposeTool(repository), validProposal());
      expect(output).toMatchObject({
        ok: false,
        code: "COMPONENT_RECEIPT_INVALID",
      });
      expect(repository.issueReceipt).not.toHaveBeenCalled();
    }
  });

  it("recusa Recibo reutilizado quando o consumo atômico falha", async () => {
    const repository = makeRepository({
      consumeComponentReceipt: vi.fn(async () => false),
    });
    const output = await invoke(proposeTool(repository), validProposal());
    expect(output).toMatchObject({
      ok: false,
      code: "COMPONENT_RECEIPT_INVALID",
    });
    expect(repository.issueReceipt).not.toHaveBeenCalled();
  });

  it("caminho feliz: consome o Recibo uma vez e emite a proposta na posição pedida", async () => {
    const dashboardId = "00000000-0000-4000-8000-000000000010";
    const existing = dashboardDocumentSchema.parse({
      id: dashboardId,
      name: "Atual",
      workspace: { params: [] },
      queryBindings: [],
      ui: {
        layout: { gap: 16 },
        components: ["a", "b"].map((id) => ({
          id,
          component: "stat_card",
          layoutProps: { colSpan: 6, rowSpan: 1 },
          props: { title: id, queryUuid: queryId, field: "amount" },
        })),
      },
    });
    const events: AiToolProgressEvent[] = [];
    const repository = makeRepository({
      findDashboard: vi.fn(async () => ({
        document: existing,
        fingerprint: "r1",
      })),
    });
    const tool = proposeTool(repository, {
      onToolEvent: (event) => {
        events.push(event);
      },
    });
    const { destination: _d, ...base } = validProposal();
    const output = await invoke(tool, {
      ...base,
      mode: "update",
      dashboardId,
      destination: { kind: "existing_dashboard", dashboardId },
      position: { placement: "before", relativeToComponentId: "b" },
    });
    expect(output).toMatchObject({ canCommit: true });
    const preview = eventFrom(events, "dashboard_preview");
    expect(preview.document.ui.components.map((c) => c.id)).toEqual([
      "a",
      "monthly-chart",
      "b",
    ]);
    expect(repository.consumeComponentReceipt).toHaveBeenCalledOnce();
    expect(repository.consumeComponentReceipt).toHaveBeenCalledWith(
      componentReceiptId,
      actorId,
      new Date(now),
    );
    expect(repository.issueReceipt).toHaveBeenCalledOnce();
  });

  it("preview_component emite o cartão e cria Recibo ainda não aprovado, ligado ao Ator", async () => {
    const events: AiToolProgressEvent[] = [];
    const repository = makeRepository();
    const tool = createAiDashboardTools({
      currentUser: admin,
      repository,
      onToolEvent: (event) => {
        events.push(event);
      },
    }).find((candidate) => candidate.name === "preview_component")!;
    await invoke(tool, { component: approvedComponent });
    const issued = vi.mocked(repository.issueComponentReceipt).mock
      .calls[0]![0];
    expect(issued).toMatchObject({ actorId, component: approvedComponent });
    expect(
      events.find((event) => event.type === "component_preview"),
    ).toMatchObject({ receiptId: issued.id, component: approvedComponent });
  });
});
