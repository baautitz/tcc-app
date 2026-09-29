import { tool, type StructuredToolInterface, type ToolRuntime } from "@langchain/core/tools";
import { z } from "zod";
import { dashboardDocumentSchema } from "../lib/contracts.js";
import type { AuthenticatedUser } from "./auth.js";
import { buildDashboardDefinitionFromDocument, dashboardQueryReferences, type DashboardQueryMetadata } from "./dashboard-sync.js";
import type { DashboardDocument } from "./dashboards.js";
import {
  aiDashboardProposalInputSchema,
  createDashboardDocument,
  dashboardDocumentFingerprint,
  dashboardReferenceFingerprint,
  DASHBOARD_PROPOSAL_TTL_MS,
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
    description: "Lista as consultas já salvas que o administrador pode executar, com UUID, nome, parâmetros e servidor. Nunca lista SQL nem recibos de teste.",
    schema: z.object({}).strict(),
  });
  const getSavedQuery = tool(async ({ queryUuid }) => {
    const [query] = await options.repository.findSavedQueries([queryUuid]);
    if (!query) throw new Error("A query não existe no catálogo salvo permitido ao administrador.");
    return {
      id: query.id,
      name: query.name,
      dataSourceId: query.dataSourceId,
      sqlText: query.sqlText,
      parameters: query.parameters,
      updatedAt: query.updatedAt.toISOString(),
      instruction: "Use os aliases explícitos do SELECT nas propriedades field, nameKey, valueKey e columns do componente. Não use testRunId no lugar do UUID salvo.",
    };
  }, {
    name: "get_saved_query",
    description: "Lê o SQL, parâmetros e versão de uma query salva pelo UUID para identificar os aliases que os componentes podem renderizar. Disponível ao administrador.",
    schema: z.object({ queryUuid: z.string().uuid() }).strict(),
  });
  const getCurrentDashboard = tool(async ({ dashboardId }) => {
    const id = dashboardId ?? options.pageDashboardId;
    if (!id) throw new Error("Abra um dashboard para editar ou informe seu UUID.");
    const current = await options.repository.findDashboard(id);
    if (!current) throw new Error("O dashboard não existe no catálogo atual.");
    return {
      dashboardId: current.document.id,
      revision: current.fingerprint,
      document: current.document,
      instruction: "Use esta versão como base da proposta e preserve workspace.params, queryBindings e componentes que não foram solicitados para alteração.",
    };
  }, {
    name: "get_current_dashboard",
    description: "Lê o documento e a revisão atual de um dashboard que o administrador pretende editar, para preservar parâmetros e mapeamentos não alterados.",
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

      const referenceIds = [...dashboardQueryReferences(document)];
      if (referenceIds.length === 0) throw new Error("Adicione ao menos uma query salva ao dashboard.");
      if (referenceIds.length > 4) throw new Error("A prévia aceita até quatro queries distintas por dashboard. Reutilize queries entre componentes.");
      const definitions = await options.repository.findSavedQueries(referenceIds);
      if (definitions.length !== referenceIds.length) throw new Error("Uma ou mais referências não correspondem a queries salvas que o administrador pode executar.");
      const definition = buildDashboardDefinitionFromDocument(
        document,
        definitions.map((query): DashboardQueryMetadata => ({ id: query.id, parameters: query.parameters })),
        { validateCatalog: true },
      );

      const bindingByQueryId = new Map(document.queryBindings.map((binding) => [binding.queryUuid, binding]));
      const previewRows: Record<string, AiDashboardQueryPreview> = {};
      for (const query of definitions) {
        const values: Record<string, string | string[]> = {};
        const binding = bindingByQueryId.get(query.id);
        for (const [parameterName, source] of Object.entries(binding?.parameters ?? {})) {
          if (source.source === "manual") values[parameterName] = source.value;
          else if (Object.hasOwn(parsed.contextValues, source.argument)) values[parameterName] = parsed.contextValues[source.argument]!;
        }
        try {
          previewRows[query.id] = await options.repository.runPreview(query, values);
        } catch (error) {
          previewRows[query.id] = {
            rows: [], rowLimit: 50, byteLimit: 48_000, bytes: 0,
            truncated: false, truncationReason: null,
            error: error instanceof Error ? error.message.slice(0, 400) : "A consulta falhou durante a prévia.",
          };
        }
      }

      const issues = validatePreviewFields(document, previewRows);
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
        expiresAt: expiresAt.toISOString(),
        mode,
        dashboardId,
        expectedDashboardFingerprint: previous?.fingerprint ?? null,
        document,
        definition,
        queries: previewRows,
        changeSummary: summarizeDashboardChanges(document, previous?.document),
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
        componentCount: definition.components.length,
        queryCount: referenceIds.length,
        expiresAt: expiresAt.toISOString(),
        canCommit: issues.length === 0,
        issues,
        instruction: issues.length
          ? "A prévia encontrou erros ou componentes vazios. Explique os problemas ao administrador, ajuste as queries ou aliases e gere uma nova proposta; não há recibo para confirmação."
          : "Esta prévia não salvou alterações. Aguarde o clique explícito do administrador em Criar dashboard ou Aplicar alterações. Nunca afirme que foi salvo antes da confirmação.",
      };
    } finally {
      await emit({ type: "tool_result", toolCallId, toolName: "create_or_update_dashboard", ok });
    }
  }, {
    name: "create_or_update_dashboard",
    description: "Gera uma proposta e prévia visual de dashboard usando somente queries salvas obtidas por list_saved_queries. Não persiste o dashboard. Para criar, mode=create. Para editar o atual, mode=update e use o UUID informado no contexto da tela.",
    schema: aiDashboardProposalInputSchema,
  });

  return [listQueries, getSavedQuery, getCurrentDashboard, proposeDashboard];
}

function validatePreviewFields(document: DashboardDocument, rowsByQuery: Record<string, AiDashboardQueryPreview>): string[] {
  const issues: string[] = [];
  for (const component of document.ui.components) {
    const props = component.props as Record<string, unknown>;
    const queryUuid = String(props.queryUuid);
    const rows = rowsByQuery[queryUuid]?.rows ?? [];
    if (!String(props.title ?? "").trim()) issues.push(`O componente '${component.id}' precisa de um título.`);
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
      for (const field of [props.nameKey, props.valueKey]) {
        if (typeof field !== "string" || !keys.has(field)) issues.push(`Os aliases do gráfico '${component.id}' precisam existir no resultado: categoria e valor.`);
      }
      if (!rows.some((row) => {
        const value = row[String(props.valueKey)];
        return typeof value === "number" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)));
      })) issues.push(`O gráfico '${component.id}' precisa retornar ao menos um valor numérico.`);
      if (typeof props.nameKey === "string" && !rows.some((row) => row[props.nameKey as string] !== null && row[props.nameKey as string] !== undefined && String(row[props.nameKey as string]).trim() !== "")) {
        issues.push(`O gráfico '${component.id}' precisa retornar ao menos uma categoria para exibir.`);
      }
      continue;
    }
    const columns = props.columns;
    if (!Array.isArray(columns) || columns.some((column) => !column || typeof column !== "object" || !("key" in column) || typeof column.key !== "string" || !keys.has(column.key))) {
      issues.push(`As colunas da tabela '${component.id}' precisam corresponder aos aliases da query.`);
    } else if (!rows.some((row) => columns.some((column) => row[column.key] !== null && row[column.key] !== undefined))) {
      issues.push(`A tabela '${component.id}' não possui valores nas colunas configuradas.`);
    }
  }
  for (const argument of document.workspace.params) {
    const lookup = argument.lookup;
    if (!lookup) continue;
    const keys = new Set(Object.keys(rowsByQuery[lookup.queryUuid]?.rows[0] ?? {}));
    if (!keys.has(lookup.valueField) || !keys.has(lookup.labelField)) {
      issues.push(`A query de opções do filtro '${argument.label}' não retornou os campos configurados.`);
    }
  }
  return [...new Set(issues)];
}
