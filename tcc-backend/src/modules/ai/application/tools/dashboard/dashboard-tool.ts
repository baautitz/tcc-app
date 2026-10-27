import {
  tool,
  type StructuredToolInterface,
  type ToolRuntime,
} from "@langchain/core/tools";
import { z } from "zod";
import { stableJson } from "../../../../../shared/lib/hash.js";
import {
  dashboardDocumentSchema,
  parameterDefinitionSchema,
} from "../../../../../shared/lib/contracts.js";
import {
  dashboardSyncService,
  type DashboardQueryMetadata,
} from "../../../../dashboards/application/dashboard-sync.js";
import {
  AI_QUERY_MAX_BYTES,
  AI_QUERY_MAX_ROWS,
} from "../../../../data-sources/domain/external-source.js";
import {
  aiComponentSchema,
  aiDashboardProposalInputSchema,
  applyComponentPosition,
  COMPONENT_RECEIPT_TTL_MS,
  createDashboardDocument,
  dashboardDocumentFingerprint,
  dashboardReferenceFingerprint,
  dashboardComponentChanges,
  DASHBOARD_PROPOSAL_TTL_MS,
  dashboardProposalPreviewScope,
  makeDashboardProposalReceiptId,
  summarizeDashboardChanges,
} from "../../../../dashboards/domain/dashboard-proposals.js";
import type { AiToolProgressEvent } from "../ai-read-tools.js";
import type {
  AiComponentReceipt,
  AiDashboardToolsOptions,
  AiDashboardQueryPreview,
} from "./dashboard-types.js";
import { validateDashboardPreviewFields } from "../../../../dashboards/domain/dashboard-preview-validation.js";
import {
  describePreviewParameters,
  failedPreview,
  runComponentPreview,
  filterValuesSchema,
  isBlank,
  parameterBindingsSchema,
  parameterNamesOf,
  splitParameterValues,
  type FilterValues,
  type ParameterBindings,
} from "./component-values.js";

type DashboardRuntime = ToolRuntime & { toolCallId?: string };

/** Segundo argumento que o LangChain passa ao handler da ferramenta. */
type ToolCallRuntime = Record<string, any>;

function refusal(code: string, message: string, instruction: string) {
  return { ok: false as const, code, message, instruction };
}

/**
 * Aplica ao documento os valores/ligações guardados no Recibo de componente:
 * ligações a filtros viram `context`, parâmetros sem filtro viram `manual`.
 * Só entram filtros que existem no documento; o resto é descartado.
 */
function applyReceiptValues(
  document: ReturnType<typeof createDashboardDocument>,
  queryUuid: string,
  receipt: AiComponentReceipt,
) {
  const filterNames = new Set(
    document.workspace.params.map((parameter) => parameter.name),
  );
  const parameters: Record<
    string,
    | { source: "context"; argument: string }
    | { source: "manual"; value: string | string[] }
  > = {};
  for (const [parameter, filter] of Object.entries(
    receipt.parameterBindings ?? {},
  ))
    if (filterNames.has(filter))
      parameters[parameter] = { source: "context", argument: filter };
  for (const [parameter, value] of Object.entries(
    receipt.parameterValues ?? {},
  ))
    if (!parameters[parameter] && !isBlank(value))
      parameters[parameter] = { source: "manual", value };
  const contextValues: FilterValues = {};
  for (const [filter, value] of Object.entries(receipt.contextValues ?? {}))
    if (filterNames.has(filter) && !isBlank(value))
      contextValues[filter] = value;
  if (Object.keys(parameters).length === 0) return { document, contextValues };
  const existing = document.queryBindings.find(
    (binding) => binding.queryUuid === queryUuid,
  );
  const merged = {
    queryUuid,
    parameters: { ...existing?.parameters, ...parameters },
  };
  return {
    document: {
      ...document,
      queryBindings: existing
        ? document.queryBindings.map((binding) =>
            binding === existing ? merged : binding,
          )
        : [...document.queryBindings, merged],
    },
    contextValues,
  };
}

export class AiDashboardTools {
  constructor(private readonly options: AiDashboardToolsOptions) {
    if (!options.currentUser.isAdmin)
      throw new Error(
        "As propostas de dashboard estão disponíveis apenas para administradores.",
      );
  }

  private async emit(event: AiToolProgressEvent) {
    try {
      await this.options.onToolEvent?.(event);
    } catch {
      /* streaming progress is best-effort */
    }
  }

  private async listQueries() {
    const queries = await this.options.repository.listSavedQueries();
    return {
      total: queries.length,
      queries: queries
        .slice(0, 200)
        .map(({ id, name, dataSourceId, parameters, updatedAt }) => ({
          id,
          name,
          dataSourceId,
          parameters,
          updatedAt: updatedAt.toISOString(),
        })),
      truncated: queries.length > 200,
      instruction:
        "Use somente esses UUIDs salvos como queryUuid. Um testRunId é recibo de prévia, nunca é UUID de query salva.",
    };
  }

  private async getSavedQuery({ queryUuid }: { queryUuid: string }) {
    const [query] = await this.options.repository.findSavedQueries([queryUuid]);
    if (!query) {
      return {
        ok: false,
        code: "SAVED_QUERY_NOT_FOUND",
        message:
          "A query não existe no catálogo salvo permitido ao administrador.",
        instruction:
          "Confira list_saved_queries e use somente o UUID atual retornado. Um testRunId é temporário; se a query não estiver na lista, pare e informe que ela precisa ser salva antes de montar o dashboard.",
      };
    }
    return {
      id: query.id,
      name: query.name,
      dataSourceId: query.dataSourceId,
      sqlText: query.sqlText,
      parameters: query.parameters,
      updatedAt: query.updatedAt.toISOString(),
      instruction:
        "Este é o SQL e os parâmetros atuais da query salva. Para editá-la, preserve servidor, parâmetros, tipos e required, altere somente o solicitado e teste com mode='update' e este mesmo queryId. Use os aliases explícitos do SELECT nas propriedades field, nameKey, valueKey e columns do componente. Não use testRunId no lugar do UUID salvo.",
    };
  }

  private async getCurrentDashboard({ dashboardId }: { dashboardId?: string }) {
    const id = dashboardId ?? this.options.pageDashboardId;
    if (!id)
      throw new Error("Abra um dashboard para editar ou informe seu UUID.");
    const current = await this.options.repository.findDashboard(id);
    if (!current) throw new Error("O dashboard não existe no catálogo atual.");
    const filters = current.document.workspace.params.map((parameter) => ({
      name: parameter.name,
      label: parameter.label,
      type: parameter.type,
      required: parameter.required,
      options: parameter.options?.map((option) => ({
        label: option.label,
        value: option.value,
      })),
      lookup: parameter.lookup,
    }));
    const dateFilters = filters.filter((filter) => filter.type === "date");
    const dateFilterNames = dateFilters
      .map((filter) => `“${filter.label}” (${filter.name})`)
      .join(", ");
    return {
      dashboardId: current.document.id,
      revision: current.fingerprint,
      document: current.document,
      filters,
      queryBindings: current.document.queryBindings,
      filterDecision: {
        requiredBeforeAddingQuery: filters.length > 0,
        hasDateFilter: dateFilters.length > 0,
        dateFilters: dateFilters.map(({ name, label }) => ({ name, label })),
        instruction: dateFilters.length
          ? `Compare os parâmetros da query com os filtros e bindings reais. Como há filtro(s) de data ${dateFilterNames}, se o pedido fixa um período específico pergunte se a tabela mantém esse período ou acompanha dinamicamente o(s) filtro(s) listado(s). Se o administrador já pediu os filtros disponíveis, aplique as dimensões compatíveis sem perguntar por cada uma. Use nomes e labels exatos; não presuma start_date, end_date ou categories. Aguarde a resposta sobre período antes de aplicar o patch.`
          : filters.length
            ? "Este dashboard não tem filtro de data. Não pergunte sobre período fixo versus dinâmico; compare os parâmetros com os filtros reais e aplique os que forem compatíveis, sem perguntar por cada dimensão. Informe se nenhum filtro existente for compatível."
            : "Este dashboard não tem filtros em workspace.params; informe que não há filtros para ligar à nova tabela.",
      },
      instruction:
        "Use esta versão como base do patch e preserve nome, descrição, espaçamento, workspace.params, queryBindings e componentes não solicitados para alteração. Para reordenar componentes, envie todos os componentes sobreviventes em components, com os IDs e definições atuais, na ordem desejada; a ordem do array completo será aplicada. Se enviar apenas componentes parciais, os componentes omitidos mantêm a posição. Para remover componente, use o ID exato em removeComponentIds; omitir um componente não o remove. Gere uma prévia visual dos componentes propostos; nenhuma mudança será salva até o administrador clicar em Aplicar alterações.",
    };
  }

  /** Fase 3: renderiza o componente isolado e emite um Recibo de componente a aprovar. */
  private async previewComponent(
    input: {
      component: z.infer<typeof aiComponentSchema>;
      previewValues?: Record<string, string | string[]>;
      parameterBindings?: ParameterBindings;
    },
    runtime: ToolCallRuntime,
  ) {
    const component = aiComponentSchema.parse(input.component);
    const toolCallId =
      (runtime as DashboardRuntime).toolCallId ?? crypto.randomUUID();
    await this.emit({
      type: "tool_start",
      toolCallId,
      toolName: "preview_component",
    });
    let ok = false;
    try {
      const activeDashboard = this.options.pageDashboardId
        ? await this.options.repository.findDashboard(
            this.options.pageDashboardId,
          )
        : undefined;
      if (!this.options.pageDashboardId || !activeDashboard) {
        await this.emit({ type: "dashboard_required", toolCallId });
        return refusal(
          "DASHBOARD_REQUIRED",
          this.options.pageDashboardId
            ? "O Dashboard ativo não existe mais no catálogo."
            : "Não há Dashboard ativo: a conversa não está em um dashboard nem o administrador escolheu um.",
          "A interface abriu um seletor de dashboard. Encerre a rodada sem repetir o pedido nem perguntar o dashboard; quando o administrador escolher, a conversa continua com o Dashboard ativo no contexto e você chama preview_component de novo.",
        );
      }
      const [query] = await this.options.repository.findSavedQueries([
        component.queryUuid,
      ]);
      if (!query)
        return refusal(
          "SAVED_QUERY_NOT_FOUND",
          "A query do componente não existe no catálogo salvo.",
          "Use um UUID de list_saved_queries; a query precisa estar salva (fase 2).",
        );
      const parameterNames = parameterNamesOf(query.parameters);
      const filters = activeDashboard.document.workspace.params.map(
        (parameter) => ({
          name: parameter.name,
          label: parameter.label,
          type: parameter.type,
          required: parameter.required,
          options: parameter.options?.map((option) => ({
            label: option.label,
            value: option.value,
          })),
          lookup: parameter.lookup,
        }),
      );
      const bindings = input.parameterBindings ?? {};
      const invalidBindings = Object.entries(bindings).filter(
        ([parameter, filter]) =>
          !parameterNames.includes(parameter) ||
          !filters.some((candidate) => candidate.name === filter),
      );
      if (invalidBindings.length > 0)
        return refusal(
          "PARAMETER_BINDING_INVALID",
          `Ligação inválida: ${invalidBindings.map(([parameter, filter]) => `${parameter} -> ${filter}`).join(", ")}. O parâmetro precisa existir na query e o filtro no Dashboard ativo.`,
          "Use nomes exatos de get_saved_query (parâmetros) e get_current_dashboard (filtros), ou omita parameterBindings.",
        );
      const { contextValues, parameterValues } = splitParameterValues(
        parameterNames,
        bindings,
        input.previewValues ?? {},
      );
      const { preview, issues } = await runComponentPreview(
        this.options.repository,
        component,
        query,
        input.previewValues ?? {},
      );
      if (issues.length > 0)
        return refusal(
          "COMPONENT_PREVIEW_INVALID",
          issues.join(" "),
          "Nenhum cartão foi gerado. Corrija os aliases do componente (ou a query) e chame preview_component de novo.",
        );
      const id = makeDashboardProposalReceiptId();
      const expiresAt = new Date(
        (this.options.now ?? Date.now)() + COMPONENT_RECEIPT_TTL_MS,
      );
      await this.options.repository.issueComponentReceipt({
        id,
        actorId: this.options.currentUser.id,
        component,
        expiresAt,
        dashboardId: this.options.pageDashboardId,
        parameterBindings: bindings,
      });
      const lookups: Record<string, AiDashboardQueryPreview> = {};
      const lookupIds = [
        ...new Set(
          filters.flatMap((filter) =>
            filter.lookup ? [filter.lookup.queryUuid] : [],
          ),
        ),
      ];
      const lookupQueries =
        await this.options.repository.findSavedQueries(lookupIds);
      const lookupPreviews = await Promise.all(
        lookupQueries.map(async (lookup) => {
          try {
            return await this.options.repository.runPreview(lookup, {});
          } catch (error) {
            return failedPreview(error, "A consulta do filtro falhou.");
          }
        }),
      );
      lookupQueries.forEach((lookup, index) => {
        lookups[lookup.id] = lookupPreviews[index]!;
      });
      await this.emit({
        type: "component_preview",
        toolCallId,
        receiptId: id,
        expiresAt: expiresAt.toISOString(),
        component,
        query: preview,
        parameters: describePreviewParameters(
          query.parameters,
          bindings,
          input.previewValues ?? {},
        ),
        filters,
        bindings,
        contextValues,
        parameterValues,
        lookups,
      });
      ok = true;
      return {
        componentReceiptId: id,
        expiresAt: expiresAt.toISOString(),
        instruction:
          "O componente isolado está no cartão com Aprovar e Pedir ajuste. Nada foi salvo. Encerre a rodada e aguarde a resposta do administrador. Só use componentReceiptId em create_or_update_dashboard depois de ele aprovar; em caso de ajuste, chame preview_component de novo.",
      };
    } finally {
      await this.emit({
        type: "tool_result",
        toolCallId,
        toolName: "preview_component",
        ok,
      });
    }
  }

  /**
   * Gates das fases 3 e 4. Só componentes novos ou alterados (`changedIds`,
   * comparados ao documento atual) exigem Recibo, destino e posição; reordenar
   * e remover não. Cada Recibo cobre um único componente.
   */
  private async checkPhases(
    parsed: z.infer<typeof aiDashboardProposalInputSchema>,
    changedIds: string[],
  ): Promise<
    | { refused: ReturnType<typeof refusal> }
    | {
        approvedId: string | undefined;
        approvedQueryUuid?: string;
        receipt?: AiComponentReceipt;
      }
  > {
    const refuse = (code: string, message: string, instruction: string) => ({
      refused: refusal(code, message, instruction),
    });
    if (parsed.destination) {
      const { kind, dashboardId } = parsed.destination;
      const consistent =
        kind === "new_dashboard"
          ? parsed.mode === "create"
          : parsed.mode === "update" &&
            (dashboardId ?? parsed.dashboardId) === parsed.dashboardId;
      if (!consistent)
        return refuse(
          "DESTINATION_MISMATCH",
          "O destino declarado não bate com mode/dashboardId.",
          "Use new_dashboard com mode=create, ou existing_dashboard com mode=update e o mesmo dashboardId.",
        );
    }
    if (changedIds.length === 0) return { approvedId: undefined };

    if (!parsed.componentReceiptId)
      return refuse(
        "COMPONENT_RECEIPT_REQUIRED",
        "Falta o Recibo de componente: o administrador ainda não aprovou o componente isolado.",
        "Chame preview_component e aguarde o administrador aprovar o cartão antes de propor o dashboard.",
      );
    const active = this.options.pageDashboardId;
    if (
      active &&
      (parsed.mode !== "update" ||
        parsed.dashboardId !== active ||
        (parsed.destination?.kind === "existing_dashboard" &&
          parsed.destination.dashboardId !== undefined &&
          parsed.destination.dashboardId !== active))
    )
      return refuse(
        "DESTINATION_MISMATCH",
        "O destino não bate com o Dashboard ativo da conversa.",
        "O componente entra no Dashboard ativo: use mode=update com o dashboardId dele (e destination existing_dashboard com o mesmo id, ou omita destination).",
      );
    const pageDestination =
      parsed.mode === "update" &&
      parsed.dashboardId !== undefined &&
      parsed.dashboardId === this.options.pageDashboardId;
    if (!parsed.destination && !pageDestination)
      return refuse(
        "DESTINATION_REQUIRED",
        "Falta o dashboard de destino.",
        "Pergunte ao administrador em qual dashboard (novo ou existente) o componente entra; não assuma.",
      );
    if (!parsed.position)
      return refuse(
        "POSITION_REQUIRED",
        "Falta a posição do componente dentro do dashboard.",
        "Pergunte ao administrador onde o componente fica (início, fim, antes ou depois de um componente); nunca assuma o fim.",
      );

    const receipt = await this.options.repository.findComponentReceipt(
      parsed.componentReceiptId,
    );
    const now = (this.options.now ?? Date.now)();
    const approved = receipt
      ? aiComponentSchema.safeParse(receipt.component)
      : undefined;
    if (
      !receipt ||
      !approved?.success ||
      receipt.actorId !== this.options.currentUser.id ||
      receipt.approvedAt === null ||
      receipt.consumedAt !== null ||
      receipt.expiresAt.getTime() <= now
    )
      return refuse(
        "COMPONENT_RECEIPT_INVALID",
        "O Recibo de componente é inválido: não existe, é de outro usuário, não foi aprovado, expirou ou já foi usado.",
        "Gere um novo cartão com preview_component e aguarde a aprovação do administrador.",
      );
    const inProposal = parsed.components.find(
      (item) => item.id === approved.data.id,
    );
    if (!inProposal || stableJson(inProposal) !== stableJson(approved.data))
      return refuse(
        "COMPONENT_RECEIPT_INVALID",
        "O componente da proposta difere do componente que o administrador aprovou.",
        "Envie o componente exatamente como aprovado; para mudar tipo, título ou largura, gere outro cartão com preview_component.",
      );
    const targetId =
      parsed.mode === "update"
        ? (parsed.dashboardId ?? this.options.pageDashboardId)
        : undefined;
    if (receipt.dashboardId && receipt.dashboardId !== targetId)
      return refuse(
        "DASHBOARD_RECEIPT_MISMATCH",
        "O cartão aprovado foi montado com os filtros de outro dashboard que não é o alvo desta proposta.",
        "Gere um novo cartão com preview_component no dashboard alvo e aguarde a aprovação; não reaproveite o Recibo em outro dashboard.",
      );
    const unapproved = changedIds.filter((id) => id !== approved.data.id);
    if (unapproved.length > 0)
      return refuse(
        "COMPONENT_RECEIPT_REQUIRED",
        `Os componentes novos ou alterados ${unapproved.map((id) => `'${id}'`).join(", ")} não têm Recibo aprovado; cada Recibo cobre um único componente.`,
        "Aprove cada componente novo ou alterado com preview_component e proponha um por vez; reenvie os demais exatamente como estão no dashboard.",
      );
    return {
      approvedId: approved.data.id,
      approvedQueryUuid: approved.data.queryUuid,
      receipt,
    };
  }

  private async proposeDashboard(
    input: z.infer<typeof aiDashboardProposalInputSchema>,
    runtime: ToolCallRuntime,
  ) {
    const parsed = aiDashboardProposalInputSchema.parse(input);
    const toolCallId =
      (runtime as DashboardRuntime).toolCallId ?? crypto.randomUUID();
    await this.emit({
      type: "tool_start",
      toolCallId,
      toolName: "create_or_update_dashboard",
    });
    let ok = false;
    try {
      const mode = parsed.mode;
      const targetId =
        mode === "update"
          ? (parsed.dashboardId ?? this.options.pageDashboardId)
          : undefined;
      if (mode === "update" && !targetId)
        throw new Error(
          "Informe qual dashboard será alterado; a rota atual não contém um dashboard aberto.",
        );

      const previous = targetId
        ? await this.options.repository.findDashboard(targetId)
        : undefined;
      if (targetId && !previous)
        throw new Error(
          "O dashboard selecionado não existe mais. Atualize a tela antes de gerar outra proposta.",
        );
      const dashboardId = targetId ?? crypto.randomUUID();
      const normalizedInput =
        targetId && parsed.dashboardId !== targetId
          ? { ...parsed, dashboardId: targetId }
          : parsed;
      let document = createDashboardDocument(
        normalizedInput,
        dashboardId,
        previous?.document,
      );
      const changes = dashboardComponentChanges(document, previous?.document);
      const changedIds = parsed.components
        .map((component) => component.id)
        .filter((id) => changes[id] !== "unchanged");
      const phases = await this.checkPhases(parsed, changedIds);
      if ("refused" in phases) return phases.refused;
      if (phases.approvedId && parsed.position) {
        const positioned = applyComponentPosition(
          document,
          phases.approvedId,
          parsed.position,
        );
        if (!positioned.ok) {
          const { ok: _ok, ...details } = positioned;
          return refusal(details.code, details.message, details.instruction);
        }
        document = positioned.document;
      }
      // Valores e ligações aprovados no cartão viram contextValues e queryBindings.
      const contextValues: FilterValues = { ...parsed.contextValues };
      if (phases.receipt && phases.approvedQueryUuid) {
        const applied = applyReceiptValues(
          document,
          phases.approvedQueryUuid,
          phases.receipt,
        );
        document = applied.document;
        Object.assign(contextValues, applied.contextValues);
      }
      dashboardDocumentSchema.parse(document);
      const proposedComponentIds = parsed.components.map(
        (component) => component.id,
      );
      const previewScope = dashboardProposalPreviewScope(
        document,
        proposedComponentIds,
      );
      const validationScope = dashboardProposalPreviewScope(
        document,
        proposedComponentIds,
      );

      const referenceIds = [...dashboardSyncService.queryReferences(document)];
      if (
        referenceIds.length === 0 &&
        (mode === "create" || document.ui.components.length > 0)
      ) {
        throw new Error(
          "Adicione ao menos uma query salva para os componentes do dashboard.",
        );
      }
      const definitions =
        await this.options.repository.findSavedQueries(referenceIds);
      if (definitions.length !== referenceIds.length)
        throw new Error(
          "Uma ou mais referências não correspondem a queries salvas que o administrador pode executar.",
        );
      const definition = dashboardSyncService.buildDefinition(
        document,
        definitions.map((query): DashboardQueryMetadata => ({
          id: query.id,
          parameters: query.parameters,
        })),
        { validateCatalog: true },
      );

      const bindingByQueryId = new Map(
        document.queryBindings.map((binding) => [binding.queryUuid, binding]),
      );
      const validationRows: Record<string, AiDashboardQueryPreview> = {};
      for (const query of definitions.filter((item) =>
        validationScope.queryIds.has(item.id),
      )) {
        const values: Record<string, string | string[]> = {};
        const binding = bindingByQueryId.get(query.id);
        const parameters = z
          .array(parameterDefinitionSchema)
          .parse(query.parameters);
        for (const [parameterName, source] of Object.entries(
          binding?.parameters ?? {},
        )) {
          if (source.source === "manual") values[parameterName] = source.value;
          else if (Object.hasOwn(contextValues, source.argument))
            values[parameterName] = contextValues[source.argument]!;
        }
        const pendingParameters = parameters.filter((parameter) => {
          if (!parameter.required) return false;
          const value = values[parameter.name];
          return (
            value === undefined ||
            (Array.isArray(value)
              ? value.length === 0
              : value.trim().length === 0)
          );
        });
        if (pendingParameters.length > 0) {
          const pendingLabels = pendingParameters.map((parameter) => {
            const source = binding?.parameters[parameter.name];
            const argument =
              source?.source === "context"
                ? document.workspace.params.find(
                    (item) => item.name === source.argument,
                  )
                : undefined;
            return argument
              ? `“${argument.label}” (parâmetro ${parameter.label})`
              : `“${parameter.label}”`;
          });
          validationRows[query.id] = {
            rows: [],
            rowLimit: AI_QUERY_MAX_ROWS,
            byteLimit: AI_QUERY_MAX_BYTES,
            bytes: 0,
            truncated: false,
            truncationReason: null,
            previewPending: `Prévia aguardando valor para ${pendingLabels.join(", ")}. Informe os valores nos filtros acima e teste os componentes para carregar a amostra.`,
          };
          continue;
        }
        try {
          validationRows[query.id] = await this.options.repository.runPreview(
            query,
            values,
          );
        } catch (error) {
          validationRows[query.id] = {
            rows: [],
            rowLimit: AI_QUERY_MAX_ROWS,
            byteLimit: AI_QUERY_MAX_BYTES,
            bytes: 0,
            truncated: false,
            truncationReason: null,
            error:
              error instanceof Error
                ? error.message.slice(0, 400)
                : "A consulta falhou durante a prévia.",
          };
        }
      }

      const previewRows: Record<string, AiDashboardQueryPreview> = {};
      for (const queryId of previewScope.queryIds) {
        const preview = validationRows[queryId];
        if (preview) previewRows[queryId] = preview;
      }
      const issues = validateDashboardPreviewFields(
        document,
        validationRows,
        new Set(proposedComponentIds),
        new Set(validationScope.arguments.map((argument) => argument.name)),
      );
      const freshDefinitions =
        await this.options.repository.findSavedQueries(referenceIds);
      const referencesFingerprint = dashboardReferenceFingerprint(
        freshDefinitions.map((query) => ({
          queryId: query.id,
          queryUpdatedAt: query.updatedAt,
          dataSourceId: query.dataSourceId,
          sourceUpdatedAt: query.sourceUpdatedAt,
          sourceTargetHash: query.sourceTargetHash,
        })),
      );
      const originalFingerprint = dashboardReferenceFingerprint(
        definitions.map((query) => ({
          queryId: query.id,
          queryUpdatedAt: query.updatedAt,
          dataSourceId: query.dataSourceId,
          sourceUpdatedAt: query.sourceUpdatedAt,
          sourceTargetHash: query.sourceTargetHash,
        })),
      );
      if (
        freshDefinitions.length !== definitions.length ||
        referencesFingerprint !== originalFingerprint
      ) {
        throw new Error(
          "Uma query ou servidor mudou durante a prévia. Gere a proposta novamente.",
        );
      }

      const id = makeDashboardProposalReceiptId();
      const expiresAt = new Date(
        (this.options.now ?? Date.now)() + DASHBOARD_PROPOSAL_TTL_MS,
      );
      const documentFingerprint = dashboardDocumentFingerprint(document);
      const hasTruncatedPreview = Object.values(previewRows).some(
        (query) => query.truncated,
      );
      const preview = {
        type: "dashboard_preview" as const,
        toolCallId,
        proposalId: id,
        previewComponentIds: previewScope.componentIds,
        expiresAt: expiresAt.toISOString(),
        mode,
        dashboardId,
        expectedDashboardFingerprint: previous?.fingerprint ?? null,
        document,
        definition,
        queries: previewRows,
        changeSummary: summarizeDashboardChanges(document, previous?.document),
        componentChanges: dashboardComponentChanges(
          document,
          previous?.document,
        ),
        contextValues,
        canCommit: issues.length === 0,
        issues,
        requiresTruncationAcknowledgement: hasTruncatedPreview,
      };
      if (Buffer.byteLength(JSON.stringify(preview), "utf8") > 128_000) {
        throw new Error(
          "A prévia do dashboard excede o tamanho permitido. Reduza componentes ou colunas retornadas pelas queries.",
        );
      }
      if (issues.length === 0) {
        const consumed = await this.options.repository.issueReceipt(
          {
            id,
            actorId: this.options.currentUser.id,
            mode,
            dashboardId,
            expectedDashboardFingerprint: previous?.fingerprint ?? null,
            document,
            documentFingerprint,
            referenceFingerprint: referencesFingerprint,
            hasTruncatedPreview,
            expiresAt,
          },
          // O Recibo de componente só é consumido junto com a emissão do
          // Recibo da proposta (mesma transação): falha aqui não o queima.
          phases.approvedId && parsed.componentReceiptId
            ? {
                consumeComponentReceipt: {
                  id: parsed.componentReceiptId,
                  actorId: this.options.currentUser.id,
                  now: new Date((this.options.now ?? Date.now)()),
                },
              }
            : undefined,
        );
        if (!consumed)
          return refusal(
            "COMPONENT_RECEIPT_INVALID",
            "O Recibo de componente já foi usado ou expirou.",
            "Gere um novo cartão com preview_component e aguarde a aprovação do administrador.",
          );
      }
      await this.emit(preview);
      ok = true;
      return {
        proposalId: id,
        mode,
        dashboardId,
        name: document.name,
        componentCount: previewScope.componentIds.length,
        queryCount: previewScope.componentQueryIds.size,
        expiresAt: expiresAt.toISOString(),
        canCommit: issues.length === 0,
        issues,
        instruction: issues.length
          ? "A prévia encontrou erros ou componentes vazios. Explique os problemas ao administrador, ajuste as queries ou aliases e gere uma nova proposta; não há recibo para confirmação."
          : Object.values(validationRows).some((query) => query.previewPending)
            ? "Uma ou mais amostras não foram executadas porque faltaram valores de filtros obrigatórios. Explique quais filtros precisam ser preenchidos ao abrir o dashboard. A configuração continua válida porque os parâmetros estão mapeados; aguarde o clique explícito do administrador para salvar. Nunca afirme que foi salvo antes da confirmação."
            : parsed.removeComponentIds.length > 0
              ? "A remoção está apenas proposta, ainda não foi aplicada. Diga ao administrador que a proposta está pronta e peça que clique em 'Aplicar alterações' no cartão para confirmar. Nunca diga que o componente já foi removido."
              : "Esta prévia não salvou alterações. Aguarde o clique explícito do administrador em Criar dashboard ou Aplicar alterações. Nunca afirme que foi salvo antes da confirmação.",
      };
    } finally {
      await this.emit({
        type: "tool_result",
        toolCallId,
        toolName: "create_or_update_dashboard",
        ok,
      });
    }
  }

  tools(): StructuredToolInterface[] {
    return [
      tool(() => this.listQueries(), {
        name: "list_saved_queries",
        description:
          "Lista as consultas salvas do administrador com UUID, nome, parâmetros e servidor. Use para localizar pelo nome uma query que será editada ou vinculada a um dashboard. Nunca lista SQL nem recibos de teste.",
        schema: z.object({}).strict(),
      }),
      tool(({ queryUuid }) => this.getSavedQuery({ queryUuid }), {
        name: "get_saved_query",
        description:
          "Lê o SQL, parâmetros e versão atuais de uma query salva pelo UUID. Use também antes de editar uma query existente; preserve os metadados e reutilize o mesmo UUID em test_query mode=update.",
        schema: z.object({ queryUuid: z.string().uuid() }).strict(),
      }),
      tool(({ dashboardId }) => this.getCurrentDashboard({ dashboardId }), {
        name: "get_current_dashboard",
        description:
          "Lê o documento, filtros reais (workspace.params), bindings, IDs dos componentes e revisão atual do dashboard que o administrador pretende editar. Ao adicionar query, compare seus parâmetros com os filtros retornados. Pergunte fixo versus dinâmico somente se houver filtro de data e o pedido contiver período explícito. Se já pediram para usar os filtros disponíveis, aplique os compatíveis sem perguntar de novo por cada dimensão. Preserve parâmetros, bindings e componentes existentes, exceto remoções pedidas explicitamente pelos IDs retornados. Para reordenar, envie todos os componentes sobreviventes no array components, na ordem solicitada; para alterações parciais, os omitidos mantêm a posição. Mostre a prévia e aguarde Aplicar alterações antes de salvar.",
        schema: z
          .object({ dashboardId: z.string().uuid().optional() })
          .strict(),
      }),
      tool((input, runtime) => this.previewComponent(input, runtime), {
        name: "preview_component",
        description:
          "Fase 3: mostra o componente isolado (renderizado sozinho, com a amostra da query salva) num cartão com Aprovar e Pedir ajuste. Não persiste nada. O cartão mostra os filtros do Dashboard ativo e o administrador pode refazer a prévia com outros valores. Se a query tem parâmetros que correspondem a filtros do dashboard, passe parameterBindings (objeto parâmetro_da_query -> filtro_do_dashboard, nomes exatos de get_saved_query e get_current_dashboard); parâmetro sem filtro correspondente fica com input próprio no cartão. Retorna componentReceiptId, que só vale depois de o administrador aprovar o cartão. Para um ajuste (tipo, título ou largura), chame de novo e aguarde nova aprovação. Após chamar, encerre a rodada.",
        schema: z
          .object({
            component: aiComponentSchema,
            previewValues: filterValuesSchema.optional(),
            parameterBindings: parameterBindingsSchema.optional(),
          })
          .strict(),
      }),
      tool((input, runtime) => this.proposeDashboard(input, runtime), {
        name: "create_or_update_dashboard",
        description:
          "Gera uma prévia visual e valida os dados para dashboards novos e existentes. Em mode=update, nenhuma alteração é persistida até o administrador revisar a prévia e clicar em Aplicar alterações. Leia get_current_dashboard antes de atualizar; nome, descrição, espaçamento, filtros, mapeamentos e componentes omitidos são preservados. Para reordenar, envie todos os componentes sobreviventes em components, na ordem solicitada; arrays parciais preservam a posição dos omitidos. Para adicionar use um ID novo; para alterar mantenha o ID exato do componente; para remover passe o ID exato em removeComponentIds (omitir não remove). Ao remover o último componente que usa uma query, o binding dela também é descartado, salvo se um filtro lookup ainda o usar. Nunca exclua o dashboard inteiro por esta ferramenta; a exclusão do dashboard é manual. Antes de adicionar uma query, compare os parâmetros aos filtros reais. Pergunte fixo versus dinâmico somente quando houver filtro de data e o pedido definir um período. Exige componentReceiptId (componente aprovado na fase 3 via preview_component, uso único), destination (new_dashboard, ou existing_dashboard com dashboardId; pode ser omitido só quando o dashboardId é o da página aberta) e position (placement start, end, before ou after, com relativeToComponentId nos dois últimos) ditos pelo administrador; se faltar, a chamada é recusada e você deve perguntar, nunca assumir o fim. Passe contextValues somente com valores informados explicitamente; filtros obrigatórios sem valor ficam indicados na prévia e devem ser testados antes de aplicar.",
        schema: aiDashboardProposalInputSchema,
      }),
    ];
  }
}
