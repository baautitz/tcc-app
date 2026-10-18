import { assertAiCatalogTableReferences } from "../../modules/queries/domain/security/query-security.js";

export function parseToolResult(content: unknown): Record<string, unknown> | undefined {
  if (content && typeof content === "object" && !Array.isArray(content)) {
    return content as Record<string, unknown>;
  }
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.flatMap((part) => (
        part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string"
          ? [part.text]
          : []
      )).join("")
      : "";
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    const item = record(part);
    return item?.type === "text" && typeof item.text === "string"
      ? [item.text]
      : [];
  }).join(" ");
}

export function optionalMultiSelectFilterIssue(input: Record<string, unknown>): string | undefined {
  if (typeof input.sqlText !== "string" || !Array.isArray(input.parameters))
    return undefined;
  for (const value of input.parameters) {
    const parameter = record(value);
    if (
      !parameter ||
      parameter.required === true ||
      parameter.type !== "multi_select" ||
      typeof parameter.name !== "string"
    ) continue;

    const name = parameter.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const placeholder = String.raw`\{\{\s*${name}\s*\}\}`;
    const usedAsFilter = new RegExp(
      String.raw`\b(?:CARDINALITY|ARRAY_LENGTH)\s*\(\s*${placeholder}|\bANY\s*\(\s*${placeholder}`,
      "i",
    ).test(input.sqlText);
    if (!usedAsFilter) continue;

    const handlesEmptyAndNull = new RegExp(
      String.raw`COALESCE\s*\(\s*(?:CARDINALITY|ARRAY_LENGTH)\s*\(\s*${placeholder}[\s\S]{0,80}?\)\s*,\s*0\s*\)\s*=\s*0`,
      "i",
    ).test(input.sqlText);
    if (!handlesEmptyAndNull) {
      return `O parâmetro opcional multi_select '{{${parameter.name}}}' é usado como filtro sem tratar NULL/lista vazia como “todas as opções”. Preserve required=false e proteja o filtro com COALESCE(CARDINALITY({{${parameter.name}}}::text[]), 0) = 0 OR coluna = ANY({{${parameter.name}}}::text[]) antes de executar a query.`;
    }
  }
  return undefined;
}

export function clearPendingResponse(runtimeContext: unknown): void {
  const clear = record(runtimeContext)?.clearPendingResponse;
  if (typeof clear === "function") clear();
}

export function queryPreflightIssue(
  messages: readonly unknown[],
  args: unknown,
  runtimeContext?: unknown,
): string | undefined {
  const input = record(args);
  if (!input) return "A chamada de teste está incompleta. Corrija os argumentos antes de validar.";
  const dataSourceId = typeof input.dataSourceId === "string" ? input.dataSourceId : undefined;
  const sqlText = typeof input.sqlText === "string" ? input.sqlText : undefined;
  if (!dataSourceId || !sqlText) return "A chamada de teste está incompleta. Corrija os argumentos antes de validar.";
  const optionalFilterIssue = optionalMultiSelectFilterIssue(input);
  if (optionalFilterIssue) return optionalFilterIssue;

  const successfulToolResults = messages.flatMap((message) => {
    const candidate = record(message);
    if (candidate?.type !== "tool" || candidate.status === "error") return [];
    const result = parseToolResult(candidate.content);
    return result ? [{ name: candidate.name, result }] : [];
  });
  if (input.mode === "update") {
    const queryId = typeof input.queryId === "string" ? input.queryId : undefined;
    const listedQuery = successfulToolResults.some(({ name, result }) => name === "list_saved_queries"
      && Array.isArray(result.queries)
      && result.queries.some((query) => record(query)?.id === queryId));
    if (!listedQuery) return "Antes de editar, use list_saved_queries e selecione o UUID atual da query solicitada.";
    const savedQuery = successfulToolResults.find(({ name, result }) => name === "get_saved_query"
      && result.id === queryId);
    if (!savedQuery) return "Antes de editar, leia o SQL e os parâmetros atuais com get_saved_query para este UUID.";
    if (savedQuery.result.dataSourceId !== dataSourceId) {
      return "Use em test_query o servidor dataSourceId retornado por get_saved_query para esta query.";
    }
    // The saved SQL is the schema context for a targeted edit. test_query still
    // performs the authoritative live catalog, SQL safety, and PostgreSQL checks.
    // Re-discovering every unchanged table and profiling unrelated filters here
    // only blocks edits when those read tools are temporarily unavailable.
    return undefined;
  }
  const listedSource = successfulToolResults.some(({ name, result }) => name === "list_data_sources"
    && Array.isArray(result.sources)
    && result.sources.some((source) => record(source)?.id === dataSourceId));
  if (!listedSource) return "Antes do teste, liste as fontes disponíveis e confirme o ID da fonte escolhida.";

  const sourceCatalogResults = successfulToolResults
    .filter(({ name, result }) => name === "list_data_source_tables" && record(result.dataSource)?.id === dataSourceId);
  if (sourceCatalogResults.length === 0) return "Antes do teste, consulte o catálogo atualizado da fonte para encontrar as tabelas usadas pela query.";
  const catalogTables = sourceCatalogResults
    .flatMap(({ result }) => Array.isArray(result.tables) ? result.tables : [])
    .flatMap((table) => {
      const item = record(table);
      return typeof item?.schemaName === "string" && typeof item.tableName === "string"
        ? [{ schemaName: item.schemaName, tableName: item.tableName }]
        : [];
    });
  let referencedTables: Array<{ schemaName: string; tableName: string }>;
  try {
    referencedTables = assertAiCatalogTableReferences(sqlText, catalogTables);
  } catch {
    return "A query menciona tabelas que ainda não foram localizadas no catálogo. Consulte as tabelas corretas antes de testar.";
  }
  if (referencedTables.length === 0) return undefined;

  const inspectedTables = new Set(successfulToolResults
    .filter(({ name, result }) => name === "get_data_source_table_schema" && record(result.dataSource)?.id === dataSourceId)
    .flatMap(({ result }) => {
      const table = record(result.table);
      return typeof table?.schemaName === "string" && typeof table.tableName === "string"
        ? [`${table.schemaName}\u0000${table.tableName}`]
        : [];
    }));
  const unreadTables = referencedTables.filter((table) => !inspectedTables.has(`${table.schemaName}\u0000${table.tableName}`));
  if (unreadTables.length > 0) {
    return `Antes do teste, leia o esquema atualizado de todas as tabelas usadas pela query: ${unreadTables.map((table) => `${table.schemaName}.${table.tableName}`).join(", ")}.`;
  }

  const hasDateParameter = Array.isArray(input?.parameters)
    && input.parameters.some((parameter) => record(parameter)?.type === "date");
  if (hasDateParameter) {
    const coveredTableKeys = new Set(successfulToolResults
      .filter(({ name, result }) => name === "analyze_date_coverage"
        && record(result.dataSource)?.id === dataSourceId
        && record(result.coverage) !== undefined)
      .flatMap(({ result }) => {
        const table = record(result.table);
        return typeof table?.schemaName === "string" && typeof table.tableName === "string"
          ? [`${table.schemaName}\u0000${table.tableName}`]
          : [];
      }));
    if (!referencedTables.some((table) => coveredTableKeys.has(`${table.schemaName}\u0000${table.tableName}`))) {
      return "A query tem filtro de data. Analise a cobertura real de datas em uma tabela usada pela query antes de escolher os valores do teste.";
    }
  }
  const hasMultiSelectParameter = Array.isArray(input?.parameters)
    && input.parameters.some((parameter) => record(parameter)?.type === "multi_select");
  if (hasMultiSelectParameter) {
    const profiledTableKeys = new Set(successfulToolResults
      .filter(({ name, result }) => name === "analyze_column_values"
        && record(result.dataSource)?.id === dataSourceId
        && Array.isArray(result.values))
      .flatMap(({ result }) => {
        const table = record(result.table);
        return typeof table?.schemaName === "string" && typeof table.tableName === "string"
          ? [`${table.schemaName}\u0000${table.tableName}`]
          : [];
      }));
    if (!referencedTables.some((table) => profiledTableKeys.has(`${table.schemaName}\u0000${table.tableName}`))) {
      return "A query tem filtro multi_select. Analise os valores agregados de uma coluna de dimensão compatível com o filtro antes de escolher os valores do teste.";
    }
  }
  return undefined;
}

export function dashboardPreflightIssue(messages: readonly unknown[], args: unknown, runtimeContext: unknown): string | undefined {
  const input = record(args);
  if (input?.mode !== "update") return undefined;
  const dashboardId = typeof input.dashboardId === "string"
    ? input.dashboardId
    : record(runtimeContext)?.dashboardId;
  if (typeof dashboardId !== "string") {
    return "Informe qual dashboard existente será alterado.";
  }
  const dashboardWasRead = messages.some((message) => {
    const candidate = record(message);
    if (candidate?.type !== "tool" || candidate.name !== "get_current_dashboard" || candidate.status === "error") return false;
    const result = parseToolResult(candidate.content);
    return result?.dashboardId === dashboardId;
  });
  if (!dashboardWasRead) {
    return "Antes de propor a alteração, leia o dashboard atual para conferir filtros, bindings e componentes existentes.";
  }
  return undefined;
}

export function missingEmptyPreviewAnalysis(messages: readonly unknown[]): { date: boolean; dimensions: boolean } {
  let latestTestIndex = -1;
  let latestTestWasEmpty = false;
  let latestTestNeedsDateReview = false;
  let latestTestNeedsDimensionReview = false;
  let latestTestDataSourceId: string | undefined;
  let latestTestTableKeys = new Set<string>();
  let latestCoverageIndex = -1;
  let latestProfileIndex = -1;
  messages.forEach((message, index) => {
    if (!message || typeof message !== "object") return;
    const candidate = message as { type?: unknown; name?: unknown; content?: unknown; status?: unknown };
    if (candidate.type !== "tool" || candidate.status === "error") return;
    if (candidate.name === "test_query") {
      const result = parseToolResult(candidate.content);
      latestTestIndex = index;
      latestTestWasEmpty = result?.ok === true && result.rowCount === 0;
      latestTestNeedsDateReview = latestTestWasEmpty
        && Array.isArray(result?.parameters)
        && result.parameters.some((parameter) => record(parameter)?.type === "date");
      latestTestNeedsDimensionReview = latestTestWasEmpty
        && Array.isArray(result?.parameters)
        && result.parameters.some((parameter) => record(parameter)?.type === "multi_select");
      latestTestDataSourceId = typeof record(result?.dataSource)?.id === "string"
        ? record(result?.dataSource)!.id as string
        : undefined;
      latestTestTableKeys = new Set();
      latestCoverageIndex = -1;
      latestProfileIndex = -1;
      if (latestTestDataSourceId && typeof result?.sqlText === "string") {
        const knownTables = messages.slice(0, index).flatMap((priorMessage) => {
          const prior = record(priorMessage);
          if (prior?.type !== "tool" || prior.name !== "list_data_source_tables" || prior.status === "error") return [];
          const listed = parseToolResult(prior.content);
          if (record(listed?.dataSource)?.id !== latestTestDataSourceId || !Array.isArray(listed?.tables)) return [];
          return listed.tables.flatMap((value) => {
            const table = record(value);
            return typeof table?.schemaName === "string" && typeof table.tableName === "string"
              ? [{ schemaName: table.schemaName, tableName: table.tableName }]
              : [];
          });
        });
        try {
          latestTestTableKeys = new Set(assertAiCatalogTableReferences(result.sqlText, knownTables)
            .map((table) => `${table.schemaName}\u0000${table.tableName}`));
        } catch {
          latestTestTableKeys = new Set();
        }
      }
    } else if (candidate.name === "analyze_date_coverage") {
      const result = parseToolResult(candidate.content);
      const sourceId = record(result?.dataSource)?.id;
      const table = record(result?.table);
      const tableKey = typeof table?.schemaName === "string" && typeof table.tableName === "string"
        ? `${table.schemaName}\u0000${table.tableName}`
        : undefined;
      const coversQueryTable = latestTestTableKeys.size === 0
        || (tableKey !== undefined && latestTestTableKeys.has(tableKey));
      if (sourceId === latestTestDataSourceId && record(result?.coverage) && coversQueryTable) latestCoverageIndex = index;
    } else if (candidate.name === "analyze_column_values") {
      const result = parseToolResult(candidate.content);
      const sourceId = record(result?.dataSource)?.id;
      const table = record(result?.table);
      const tableKey = typeof table?.schemaName === "string" && typeof table.tableName === "string"
        ? `${table.schemaName}\u0000${table.tableName}`
        : undefined;
      const coversQueryTable = latestTestTableKeys.size === 0
        || (tableKey !== undefined && latestTestTableKeys.has(tableKey));
      if (sourceId === latestTestDataSourceId && Array.isArray(result?.values) && coversQueryTable) latestProfileIndex = index;
    }
  });
  if (!latestTestWasEmpty || latestTestIndex < 0) return { date: false, dimensions: false };
  return {
    date: latestTestNeedsDateReview && latestTestIndex > latestCoverageIndex,
    dimensions: latestTestNeedsDimensionReview && latestTestIndex > latestProfileIndex,
  };
}

export function latestQueryTestResult(messages: readonly unknown[]): Record<string, unknown> | undefined {
  let latest: Record<string, unknown> | undefined;
  for (const message of messages) {
    const candidate = record(message);
    if (candidate?.type !== "tool" || candidate.name !== "test_query" || candidate.status === "error") continue;
    latest = parseToolResult(candidate.content);
  }
  return latest;
}

export function hasDashboardProposal(messages: readonly unknown[]): boolean {
  return messages.some((message) => {
    const candidate = record(message);
    if (candidate?.type !== "tool" || candidate.name !== "create_or_update_dashboard" || candidate.status === "error") return false;
    const result = parseToolResult(candidate.content);
    return typeof result?.proposalId === "string";
  });
}

export function hasPendingDashboardQuestion(messages: readonly unknown[]): boolean {
  return messages.some((message) => {
    const candidate = record(message);
    return candidate?.type === "tool" && candidate.name === "ask_admin_questions" && candidate.status !== "error";
  });
}

export function hasUnresolvedTestQueryCall(messages: readonly unknown[]): boolean {
  const testCallIds = new Set<string>();
  const resolvedCallIds = new Set<string>();
  for (const message of messages) {
    const candidate = record(message);
    if (!candidate) continue;
    if (candidate.type === "ai" && Array.isArray(candidate.tool_calls)) {
      for (const toolCall of candidate.tool_calls) {
        const call = record(toolCall);
        if (call?.name === "test_query" && typeof call.id === "string") {
          testCallIds.add(call.id);
        }
      }
    } else if (candidate.type === "tool" && typeof candidate.tool_call_id === "string") {
      resolvedCallIds.add(candidate.tool_call_id);
    }
  }
  return [...testCallIds].some((callId) => !resolvedCallIds.has(callId));
}

/** True when this turn produced something the UI renders as a card (proposal, query preview, questionnaire, context proposal). */
export function hasActionCardResult(messages: readonly unknown[]): boolean {
  return messages.some((message) => {
    const candidate = record(message);
    if (candidate?.type !== "tool" || candidate.status === "error") return false;
    const result = parseToolResult(candidate.content);
    switch (candidate.name) {
      case "create_or_update_dashboard": return typeof result?.proposalId === "string";
      case "test_query": return result?.ok === true;
      case "ask_admin_questions":
      case "propose_context_update": return true;
      default: return false;
    }
  });
}
