import { describe, expect, it, vi } from "vitest";
import { dashboardDocumentSchema } from "../../../shared/lib/contracts.js";
import {
  AiComponentPreviewService,
  type ComponentPreviewPort,
  type ComponentPreviewValues,
} from "./component-preview.js";

const actorId = "00000000-0000-4000-8000-000000000001";
const queryId = "00000000-0000-4000-8000-000000000002";
const dashboardId = "00000000-0000-4000-8000-000000000010";
const receiptId = "00000000-0000-4000-8000-0000000000a1";
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
const receipt = {
  id: receiptId,
  actorId,
  component,
  expiresAt: new Date(now + 60_000),
  approvedAt: null,
  consumedAt: null,
  dashboardId,
  parameterBindings: { start_date: "periodo_inicio" },
};
const rows = {
  rows: [{ month_label: "Setembro", amount: "125.50" }],
  rowLimit: 50,
  byteLimit: 48_000,
  bytes: 48,
  truncated: false,
  truncationReason: null,
};

function port(overrides: Partial<ComponentPreviewPort> = {}) {
  const value: ComponentPreviewPort = {
    findComponentReceipt: vi.fn(async () => receipt),
    findSavedQueries: vi.fn(async () => [
      {
        id: queryId,
        name: "q",
        dataSourceId: "s",
        sqlText: "select 1",
        parameters: [
          { name: "start_date", label: "Início", type: "date", required: true },
          { name: "seller", label: "Vendedor", type: "text", required: false },
        ],
        updatedAt: new Date(),
        sourceUpdatedAt: new Date(),
        sourceTargetHash: "h",
        connection: {},
      },
    ]),
    findDashboard: vi.fn(async () => ({
      document: dashboardDocumentSchema.parse({
        id: dashboardId,
        name: "Atual",
        workspace: {
          params: [{ name: "periodo_inicio", label: "Início", type: "date" }],
        },
        queryBindings: [],
        ui: { layout: { gap: 16 }, components: [] },
      }),
      fingerprint: "f",
    })),
    runPreview: vi.fn(async () => rows),
    approveComponentReceipt: vi.fn(async () => true),
    ...overrides,
  };
  return value;
}
const service = (p: ComponentPreviewPort) =>
  new AiComponentPreviewService(p, () => now);
const input = {
  contextValues: { periodo_inicio: "2017-01-01" },
  parameterValues: { seller: "Ana" },
};

describe("prévia do componente por valores", () => {
  it("executa a query com valores dos filtros ligados e dos parâmetros sem filtro, sem IA", async () => {
    const p = port();
    const result = await service(p).preview(actorId, receiptId, input);
    expect(result.query).toMatchObject({ rows: rows.rows });
    expect(result.query.error).toBeUndefined();
    expect(vi.mocked(p.runPreview).mock.calls[0]![1]).toEqual({
      start_date: "2017-01-01",
      seller: "Ana",
    });
  });

  it("valor inválido para o parâmetro volta como erro da prévia (validação do bind)", async () => {
    const p = port({
      runPreview: vi.fn(async () => {
        throw new Error("Parâmetro Início inválido");
      }),
    });
    const result = await service(p).preview(actorId, receiptId, input);
    expect(result.query.error).toContain("inválido");
  });

  it("recusa Recibo de outro Ator, expirado, consumido ou inexistente", async () => {
    for (const found of [
      { ...receipt, actorId: "00000000-0000-4000-8000-0000000000ff" },
      { ...receipt, expiresAt: new Date(now - 1) },
      { ...receipt, consumedAt: new Date(now - 5) },
      undefined,
    ]) {
      const p = port({ findComponentReceipt: vi.fn(async () => found) });
      await expect(
        service(p).preview(actorId, receiptId, input),
      ).rejects.toMatchObject({ status: 409 });
      expect(p.runPreview).not.toHaveBeenCalled();
    }
  });

  it("recusa filtro que o dashboard não tem e parâmetro que a query não tem", async () => {
    const invalid: ComponentPreviewValues[] = [
      { contextValues: { fantasma: "x" }, parameterValues: {} },
      { contextValues: {}, parameterValues: { fantasma: "x" } },
      // parâmetro ligado a filtro não aceita valor próprio
      { contextValues: {}, parameterValues: { start_date: "2017-01-01" } },
    ];
    for (const bad of invalid) {
      const p = port();
      await expect(
        service(p).preview(actorId, receiptId, bad),
      ).rejects.toMatchObject({ status: 400 });
      expect(p.runPreview).not.toHaveBeenCalled();
    }
  });

  it("aprovar guarda os valores aplicados no Recibo do Ator", async () => {
    const p = port();
    await service(p).approve(actorId, receiptId, input);
    expect(p.approveComponentReceipt).toHaveBeenCalledWith(
      receiptId,
      actorId,
      input,
      new Date(now),
    );
  });

  it("aprovar recusa valores com filtro desconhecido sem aprovar", async () => {
    const p = port();
    await expect(
      service(p).approve(actorId, receiptId, {
        contextValues: { fantasma: "x" },
        parameterValues: {},
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(p.approveComponentReceipt).not.toHaveBeenCalled();
  });

  it("aprovar sem valores mantém o comportamento anterior", async () => {
    const p = port();
    await service(p).approve(actorId, receiptId, undefined);
    expect(p.approveComponentReceipt).toHaveBeenCalledWith(
      receiptId,
      actorId,
      undefined,
      new Date(now),
    );
  });

  it("aprovar recusa quando o Recibo expirou ou não é do Ator", async () => {
    const p = port({ approveComponentReceipt: vi.fn(async () => false) });
    await expect(
      service(p).approve(actorId, receiptId, undefined),
    ).rejects.toMatchObject({ status: 409 });
  });
});
