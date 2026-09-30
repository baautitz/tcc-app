import { tool, type StructuredToolInterface, type ToolRuntime } from "@langchain/core/tools";
import { z } from "zod";
import { dashboardDocumentSchema, parameterDefinitionSchema } from "../lib/contracts.js";
import type { AuthenticatedUser } from "./auth.js";
import { buildDashboardDefinitionFromDocument, dashboardQueryReferences, type DashboardQueryMetadata } from "./dashboard-sync.js";
import type { DashboardDocument } from "./dashboards.js";
import { AI_QUERY_MAX_BYTES, AI_QUERY_MAX_ROWS } from "./external-postgres.js";
import {
  aiDashboardProposalInputSchema,
  createDashboardDocument,
  dashboardDocumentFingerprint,
  dashboardReferenceFingerprint,
  dashboardComponentChanges,
  DASHBOARD_PROPOSAL_TTL_MS,
  dashboardProposalPreviewScope,
  makeDashboardProposalReceiptId,
  summarizeDashboardChanges,
} from "./ai-dashboard-proposals.js";

export interface AiDashboardQuery {
  id: string;
  name: string;
  dataSourceId: string;
  parameters: unknown;
  updatedAt: Date;
  sourceUpdatedAt: Date;
  sourceTargetHash: string;
}

export interface AiDashboardQueryDefinition extends AiDashboardQuery {
  sqlText: string;
  connection: unknown;
}

export interface AiDashboardQueryPreview {
  rows: Record<string, unknown>[];
  rowLimit: number;
  byteLimit: number;
  bytes: number;
  truncated: boolean;
  truncationReason: "row_limit" | "byte_limit" | null;
  error?: string;
  previewPending?: string;
}

export interface AiDashboardToolsRepository {
  listSavedQueries(): Promise<AiDashboardQuery[]>;
  findSavedQueries(ids: string[]): Promise<AiDashboardQueryDefinition[]>;
  findDashboard(id: string): Promise<{ document: DashboardDocument; fingerprint: string } | undefined>;
  runPreview(query: AiDashboardQueryDefinition, values: Record<string, string | string[]>): Promise<AiDashboardQueryPreview>;
  issueReceipt(input: {
    id: string;
    actorId: string;
    mode: "create" | "update";
    dashboardId: string;
    expectedDashboardFingerprint: string | null;
    document: DashboardDocument;
    documentFingerprint: string;
    referenceFingerprint: string;
    hasTruncatedPreview: boolean;
    expiresAt: Date;
  }): Promise<void>;
}

type DashboardRuntime = ToolRuntime & { toolCallId?: string };

export function createAiDashboardTools(options: {
  currentUser: AuthenticatedUser;
  pageDashboardId?: string;
  repository: AiDashboardToolsRepository;
  onToolEvent?: (event: import("./ai-read-tools.js").AiToolProgressEvent) => void | Promise<void>;
}): StructuredToolInterface[] {
  if (!options.currentUser.isAdmin) throw new Error("As propostas de dashboard estão disponíveis apenas para administradores.");
  const emit = async (event: import("./ai-read-tools.js").AiToolProgressEvent) => {
    try { await options.onToolEvent?.(event); } catch { /* streaming progress is best-effort */ }
  };
  const listQueries = tool(async () => {
    const queries = await options.repository.listSavedQueries();
    return {
      total: queries.length,
      queries: queries.slice(0, 200).map(({ id, name, dataSourceId, parameters, updatedAt }) => ({
        id, name, dataSourceId, parameters, updatedAt: updatedAt.toISOString(),
      })),
      truncated: queries.length > 200,
      instruction: "Use somente esses UUIDs salvos como queryUuid. Um testRunId é recibo de prévia, nunca é UUID de query salva.",
    };
  }, {
    name: "list_saved_queries",
    description: "Lista as consultas salvas do administrador com UUID, nome, parâmetros e servidor. Use para localizar pelo nome uma query que será editada ou vinculada a um dashboard. Nunca lista SQL nem recibos de teste.",
    schema: z.object({}).strict(),
  });
  const getSavedQuery = tool(async ({ queryUuid }) => {
    const [query] = await options.repository.findSavedQueries([queryUuid]);
    if (!query) {
      return {
        ok: false,
        code: "SAVED_QUERY_NOT_FOUND",
        message: "A query não existe no catálogo salvo permitido ao administrador.",
        instruction: "Confira list_saved_queries e use somente o UUID atual retornado. Um testRunId é temporário; se a query não estiver na lista, pare e informe que ela precisa ser salva antes de montar o dashboard.",
      };
    }
    return {
      id: query.id,
      name: query.name,
      dataSourceId: query.dataSourceId,
      sqlText: query.sqlText,
      parameters: query.parameters,
      updatedAt: query.updatedAt.toISOString(),
      instruction: "Este é o SQL e os parâmetros atuais da query salva. Para editá-la, preserve servidor, parâmetros, tipos e required, altere somente o solicitado e teste com mode='update' e este mesmo queryId. Use os aliases explícitos do SELECT nas propriedades field, nameKey, valueKey e columns do componente. Não use testRunId no lugar do UUID salvo.",
    };
  }, {
    name: "get_saved_query",
    description: "Lê o SQL, parâmetros e versão atuais de uma query salva pelo UUID. Use também antes de editar uma query existente; preserve os metadados e reutilize o mesmo UUID em test_query mode=update.",
    schema: z.object({ queryUuid: z.string().uuid() }).strict(),
  });
  const getCurrentDashboard = tool(async ({ dashboardId }) => {
    const id = dashboardId ?? options.pageDashboardId;
    if (!id) throw new Error("Abra um dashboard para editar ou informe seu UUID.");
    const current = await options.repository.findDashboard(id);
    if (!current) throw new Error("O dashboard não existe no catálogo atual.");
    const filters = current.document.workspace.params.map((parameter) => ({
      name: parameter.name,
      label: parameter.label,
      type: parameter.type,
      required: parameter.required,
      options: parameter.options?.map((option) => ({ label: option.label, value: option.value })),
      lookup: parameter.lookup,
    }));
    const dateFilters = filters.filter((filter) => filter.type === "date");
    const dateFilterNames = dateFilters.map((filter) => `“${filter.label}” (${filter.name})`).join(", ");
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
      instruction: "Use esta versão como base do patch e preserve nome, descrição, espaçamento, workspace.params, queryBindings e componentes não solicitados para alteração. Para reordenar componentes, envie todos os componentes sobreviventes em components, com os IDs e definições atuais, na ordem desejada; a ordem do array completo será aplicada. Se enviar apenas componentes parciais, os componentes omitidos mantêm a posição. Para remover componente, use o ID exato em removeComponentIds; omitir um componente não o remove. Gere uma prévia visual dos componentes propostos; nenhuma mudança será salva até o administrador clicar em Aplicar alterações.",
    };
  }, {
    name: "get_current_dashboard",
    description: "Lê o documento, filtros reais (workspace.params), bindings, IDs dos componentes e revisão atual do dashboard que o administrador pretende editar. Ao adicionar query, compare seus parâmetros com os filtros retornados. Pergunte fixo versus dinâmico somente se houver filtro de data e o pedido contiver período explícito. Se já pediram para usar os filtros disponíveis, aplique os compatíveis sem perguntar de novo por cada dimensão. Preserve parâmetros, bindings e componentes existentes, exceto remoções pedidas explicitamente pelos IDs retornados. Para reordenar, envie todos os componentes sobreviventes no array components, na ordem solicitada; para alterações parciais, os omitidos mantêm a posição. Mostre a prévia e aguarde Aplicar alterações antes de salvar.",
    schema: z.object({ dashboardId: z.string().uuid().optional() }).strict(),
  });

  const proposeDashboard = tool(async (input, runtime) => {
    const parsed = aiDashboardProposalInputSchema.parse(input);
    const toolCallId = (runtime as DashboardRuntime).toolCallId ?? crypto.randomUUID();
    await emit({ type: "tool_start", toolCallId, toolName: "create_or_update_dashboard" });
    let ok = false;
    try {
      const mode = parsed.mode;
      const targetId = mode === "update" ? (parsed.dashboardId ?? options.pageDashboardId) : undefined;
      if (mode === "update" && !targetId) throw new Error("Informe qual dashboard será alterado; a rota atual não contém um dashboard aberto.");

      const previous = targetId ? await options.repository.findDashboard(targetId) : undefined;
      if (targetId && !previous) throw new Error("O dashboard selecionado não existe mais. Atualize a tela antes de gerar outra proposta.");
      const dashboardId = targetId ?? crypto.randomUUID();
      const normalizedInput = targetId && parsed.dashboardId !== targetId
        ? { ...parsed, dashboardId: targetId }
        : parsed;
      const document = createDashboardDocument(normalizedInput, dashboardId, previous?.document);
      dashboardDocumentSchema.parse(document);
      const proposedComponentIds = parsed.components.map((component) => component.id);
      const previewScope = dashboardProposalPreviewScope(
        document,
        proposedComponentIds,
      );
      const validationScope = dashboardProposalPreviewScope(
        document,
        proposedComponentIds,
      );

      const referenceIds = [...dashboardQueryReferences(document)];
      if (referenceIds.length === 0 && (mode === "create" || document.ui.components.length > 0)) {
        throw new Error("Adicione ao menos uma query salva para os componentes do dashboard.");
      }
      const definitions = await options.repository.findSavedQueries(referenceIds);
      if (definitions.length !== referenceIds.length) throw new Error("Uma ou mais referências não correspondem a queries salvas que o administrador pode executar.");
      const definition = buildDashboardDefinitionFromDocument(
        document,
        definitions.map((query): DashboardQueryMetadata => ({ id: query.id, parameters: query.parameters })),
        { validateCatalog: true },
      );

      const bindingByQueryId = new Map(document.queryBindings.map((binding) => [binding.queryUuid, binding]));
      const validationRows: Record<string, AiDashboardQueryPreview> = {};
      for (const query of definitions.filter((item) => validationScope.queryIds.has(item.id))) {
        const values: Record<string, string | string[]> = {};
        const binding = bindingByQueryId.get(query.id);
        const parameters = z.array(parameterDefinitionSchema).parse(query.parameters);
        for (const [parameterName, source] of Object.entries(binding?.parameters ?? {})) {
          if (source.source === "manual") values[parameterName] = source.value;
          else if (Object.hasOwn(parsed.contextValues, source.argument)) values[parameterName] = parsed.contextValues[source.argument]!;
        }
        const pendingParameters = parameters.filter((parameter) => {
          if (!parameter.required) return false;
          const value = values[parameter.name];
          return value === undefined || (Array.isArray(value) ? value.length === 0 : value.trim().length === 0);
        });
        if (pendingParameters.length > 0) {
          const pendingLabels = pendingParameters.map((parameter) => {
            const source = binding?.parameters[parameter.name];
            const argument = source?.source === "context"
              ? document.workspace.params.find((item) => item.name === source.argument)
              : undefined;
            return argument
              ? `“${argument.label}” (parâmetro ${parameter.label})`
              : `“${parameter.label}”`;
          });
          validationRows[query.id] = {
            rows: [], rowLimit: AI_QUERY_MAX_ROWS, byteLimit: AI_QUERY_MAX_BYTES, bytes: 0,
            truncated: false, truncationReason: null,
            previewPending: `Prévia aguardando valor para ${pendingLabels.join(", ")}. Informe os valores nos filtros acima e teste os componentes para carregar a amostra.`,
          };
          continue;
        }
        try {
          validationRows[query.id] = await options.repository.runPreview(query, values);
        } catch (error) {
          validationRows[query.id] = {
            rows: [], rowLimit: AI_QUERY_MAX_ROWS, byteLimit: AI_QUERY_MAX_BYTES, bytes: 0,
            truncated: false, truncationReason: null,
            error: error instanceof Error ? error.message.slice(0, 400) : "A consulta falhou durante a prévia.",
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
      const freshDefinitions = await options.repository.findSavedQueries(referenceIds);
      const referencesFingerprint = dashboardReferenceFingerprint(freshDefinitions.map((query) => ({
        queryId: query.id,
        queryUpdatedAt: query.updatedAt,
        dataSourceId: query.dataSourceId,
        sourceUpdatedAt: query.sourceUpdatedAt,
        sourceTargetHash: query.sourceTargetHash,
      })));
      const originalFingerprint = dashboardReferenceFingerprint(definitions.map((query) => ({
        queryId: query.id,
        queryUpdatedAt: query.updatedAt,
        dataSourceId: query.dataSourceId,
        sourceUpdatedAt: query.sourceUpdatedAt,
        sourceTargetHash: query.sourceTargetHash,
      })));
      if (freshDefinitions.length !== definitions.length || referencesFingerprint !== originalFingerprint) {
        throw new Error("Uma query ou servidor mudou durante a prévia. Gere a proposta novamente.");
      }

      const id = makeDashboardProposalReceiptId();
      const expiresAt = new Date(Date.now() + DASHBOARD_PROPOSAL_TTL_MS);
      const documentFingerprint = dashboardDocumentFingerprint(document);
      const hasTruncatedPreview = Object.values(previewRows).some((query) => query.truncated);
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
        componentChanges: dashboardComponentChanges(document, previous?.document),
        canCommit: issues.length === 0,
        issues,
        requiresTruncationAcknowledgement: hasTruncatedPreview,
      };
      if (Buffer.byteLength(JSON.stringify(preview), "utf8") > 128_000) {
        throw new Error("A prévia do dashboard excede o tamanho permitido. Reduza componentes ou colunas retornadas pelas queries.");
      }
      if (issues.length === 0) {
        await options.repository.issueReceipt({
          id,
          actorId: options.currentUser.id,
          mode,
          dashboardId,
          expectedDashboardFingerprint: previous?.fingerprint ?? null,
          document,
          documentFingerprint,
          referenceFingerprint: referencesFingerprint,
          hasTruncatedPreview,
          expiresAt,
        });
      }
      await emit(preview);
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
      await emit({ type: "tool_result", toolCallId, toolName: "create_or_update_dashboard", ok });
    }
  }, {
    name: "create_or_update_dashboard",
    description: "Gera uma prévia visual e valida os dados para dashboards novos e existentes. Em mode=update, nenhuma alteração é persistida até o administrador revisar a prévia e clicar em Aplicar alterações. Leia get_current_dashboard antes de atualizar; nome, descrição, espaçamento, filtros, mapeamentos e componentes omitidos são preservados. Para reordenar, envie todos os componentes sobreviventes em components, na ordem solicitada; arrays parciais preservam a posição dos omitidos. Para adicionar use um ID novo; para alterar mantenha o ID exato do componente; para remover passe o ID exato em removeComponentIds (omitir não remove). Ao remover o último componente que usa uma query, o binding dela também é descartado, salvo se um filtro lookup ainda o usar. Nunca exclua o dashboard inteiro por esta ferramenta; a exclusão do dashboard é manual. Antes de adicionar uma query, compare os parâmetros aos filtros reais. Pergunte fixo versus dinâmico somente quando houver filtro de data e o pedido definir um período. Passe contextValues somente com valores informados explicitamente; filtros obrigatórios sem valor ficam indicados na prévia e devem ser testados antes de aplicar.",
    schema: aiDashboardProposalInputSchema,
  });

  return [listQueries, getSavedQuery, getCurrentDashboard, proposeDashboard];
}

export function validateDashboardPreviewFields(
  document: DashboardDocument,
  rowsByQuery: Record<string, AiDashboardQueryPreview>,
  componentIds?: Set<string>,
  argumentNames?: Set<string>,
): string[] {
  const issues: string[] = [];
  for (const component of document.ui.components.filter((item) => !componentIds || componentIds.has(item.id))) {
    const props = component.props as Record<string, unknown>;
    const queryUuid = String(props.queryUuid);
    const rows = rowsByQuery[queryUuid]?.rows ?? [];
    if (!String(props.title ?? "").trim()) issues.push(`O componente '${component.id}' precisa de um título.`);
    if (rowsByQuery[queryUuid]?.previewPending) continue;
    if (rowsByQuery[queryUuid]?.error) {
      issues.push(`A query do componente '${component.id}' falhou: ${rowsByQuery[queryUuid]?.error}`);
      continue;
    }
    const keys = rows[0] ? new Set(Object.keys(rows[0])) : new Set<string>();
    if (!rows.length) {
      issues.push(`A query do componente '${component.id}' não retornou dados para a prévia. Ajuste a query ou os parâmetros.`);
      continue;
    }
    if (component.component === "stat_card") {
      if (typeof props.field !== "string" || !keys.has(props.field)) issues.push(`O campo do cartão '${component.id}' não existe no resultado da query.`);
      else if (!rows.some((row) => row[props.field as string] !== null && row[props.field as string] !== undefined)) issues.push(`O campo do cartão '${component.id}' não possui valor na prévia.`);
      continue;
    }
    if (component.component === "bar_chart" || component.component === "pie_chart") {
      const availableFields = [...keys].slice(0, 16);
      const availableFieldsLabel = availableFields.length > 0
        ? availableFields.join(", ")
        : "nenhuma coluna retornada";
      for (const [role, field] of [["categoria", props.nameKey], ["valor", props.valueKey]] as const) {
        if (typeof field !== "string" || !keys.has(field)) {
          issues.push(`O gráfico '${component.id}' usa '${String(field)}' como ${role}, mas esse alias não existe. Aliases disponíveis: ${availableFieldsLabel}.`);
        }
      }
      const hasNumericValue = (value: unknown) =>
        typeof value === "number"
          ? Number.isFinite(value)
          : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
      const hasRenderablePoint = typeof props.nameKey === "string" && typeof props.valueKey === "string"
        && rows.some((row) => {
          const category = row[props.nameKey as string];
          return category !== null && category !== undefined && String(category).trim() !== ""
            && hasNumericValue(row[props.valueKey as string]);
        });
      if (!hasRenderablePoint) issues.push(`O gráfico '${component.id}' precisa retornar ao menos uma linha com categoria preenchida e valor numérico nos aliases configurados.`);
      continue;
    }
    const columns = props.columns;
    if (!Array.isArray(columns) || columns.some((column) => !column || typeof column !== "object" || !("key" in column) || typeof column.key !== "string" || !keys.has(column.key))) {
      issues.push(`As colunas da tabela '${component.id}' precisam corresponder aos aliases da query.`);
    } else if (!rows.some((row) => columns.some((column) => row[column.key] !== null && row[column.key] !== undefined))) {
      issues.push(`A tabela '${component.id}' não possui valores nas colunas configuradas.`);
    }
  }
  for (const argument of document.workspace.params.filter((item) => !argumentNames || argumentNames.has(item.name))) {
    const lookup = argument.lookup;
    if (!lookup) continue;
    const keys = new Set(Object.keys(rowsByQuery[lookup.queryUuid]?.rows[0] ?? {}));
    if (!keys.has(lookup.valueField) || !keys.has(lookup.labelField)) {
      issues.push(`A query de opções do filtro '${argument.label}' não retornou os campos configurados.`);
    }
  }
  return [...new Set(issues)];
}
