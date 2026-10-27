import { aiComponentSchema } from "../../dashboards/domain/dashboard-proposals.js";
import { ApiError } from "../../../shared/lib/domain-error.js";
import {
  parameterNamesOf,
  resolveParameterValues,
  runComponentPreview,
  type FilterValues,
} from "./tools/dashboard/component-values.js";
import type {
  AiComponentReceipt,
  AiDashboardToolsRepository,
} from "./tools/dashboard/dashboard-types.js";

export type ComponentPreviewPort = Pick<
  AiDashboardToolsRepository,
  "findComponentReceipt" | "findSavedQueries" | "findDashboard" | "runPreview"
> & {
  approveComponentReceipt(
    id: string,
    actorId: string,
    values: ComponentPreviewValues | undefined,
    now: Date,
  ): Promise<boolean>;
};

/** Valores informados no cartão: filtros do dashboard e parâmetros sem filtro. */
export type ComponentPreviewValues = {
  contextValues: FilterValues;
  parameterValues: FilterValues;
};

const unusableReceipt = () =>
  new ApiError(
    409,
    "O componente expirou, já foi usado ou não pertence a você. Peça um novo cartão ao assistente.",
  );

/**
 * Prévia do componente isolado por valores (sem IA) e aprovação com os valores
 * aplicados. Ligada ao Recibo de componente, ao Ator e ao prazo.
 */
export class AiComponentPreviewService {
  constructor(
    private readonly port: ComponentPreviewPort,
    private readonly now: () => number = Date.now,
  ) {}

  private async usableReceipt(actorId: string, receiptId: string) {
    const receipt = await this.port.findComponentReceipt(receiptId);
    if (
      !receipt ||
      receipt.actorId !== actorId ||
      receipt.consumedAt !== null ||
      receipt.expiresAt.getTime() <= this.now()
    )
      throw unusableReceipt();
    return receipt;
  }

  /** Componente do Recibo; formato inutilizável pede um novo cartão (409). */
  private componentOf(receipt: AiComponentReceipt) {
    const parsed = aiComponentSchema.safeParse(receipt.component);
    if (!parsed.success) throw unusableReceipt();
    return parsed.data;
  }

  /** Filtros do Dashboard ativo daquele cartão (vazio se o Recibo é antigo). */
  private async filterNames(receipt: AiComponentReceipt) {
    const dashboard = receipt.dashboardId
      ? await this.port.findDashboard(receipt.dashboardId)
      : undefined;
    return new Set(
      dashboard?.document.workspace.params.map((param) => param.name) ?? [],
    );
  }

  private assertKnownNames(
    values: ComponentPreviewValues,
    filters: Set<string>,
    parameterNames: string[],
    bindings: Record<string, string>,
  ) {
    if (Object.keys(values.contextValues).some((name) => !filters.has(name)))
      throw new ApiError(
        400,
        "Os valores trazem filtros que não existem no Dashboard ativo.",
      );
    if (
      Object.keys(values.parameterValues).some(
        (name) =>
          !parameterNames.includes(name) || Object.hasOwn(bindings, name),
      )
    )
      throw new ApiError(
        400,
        "Os valores trazem parâmetros que a query não tem ou que já seguem um filtro.",
      );
  }

  async preview(
    actorId: string,
    receiptId: string,
    values: ComponentPreviewValues,
  ) {
    const receipt = await this.usableReceipt(actorId, receiptId);
    const component = this.componentOf(receipt);
    const [query] = await this.port.findSavedQueries([component.queryUuid]);
    if (!query)
      throw new ApiError(409, "A query do componente não existe mais.");
    const parameterNames = parameterNamesOf(query.parameters);
    const bindings = receipt.parameterBindings ?? {};
    this.assertKnownNames(
      values,
      await this.filterNames(receipt),
      parameterNames,
      bindings,
    );
    const { preview, issues } = await runComponentPreview(
      this.port,
      component,
      query,
      resolveParameterValues(
        parameterNames,
        bindings,
        values.contextValues,
        values.parameterValues,
      ),
    );
    return {
      query: preview.error
        ? preview
        : issues.length > 0
          ? { ...preview, error: issues.join(" ") }
          : preview,
    };
  }

  async approve(
    actorId: string,
    receiptId: string,
    values: ComponentPreviewValues | undefined,
  ) {
    if (values) {
      const receipt = await this.usableReceipt(actorId, receiptId);
      const component = this.componentOf(receipt);
      const [query] = await this.port.findSavedQueries([component.queryUuid]);
      const parameterNames = parameterNamesOf(query?.parameters);
      this.assertKnownNames(
        values,
        await this.filterNames(receipt),
        parameterNames,
        receipt.parameterBindings ?? {},
      );
    }
    const approved = await this.port.approveComponentReceipt(
      receiptId,
      actorId,
      values,
      new Date(this.now()),
    );
    if (!approved) throw unusableReceipt();
  }
}
