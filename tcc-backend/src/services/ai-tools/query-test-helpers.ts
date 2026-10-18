import type { ToolRuntime } from "@langchain/core/tools";
import type { z } from "zod";
import type { inputSchema } from "./query-test-schema.js";
import { ExternalQueryExecutionError } from "../../modules/data-sources/infrastructure/external-pg/index.js";
import type { AiReadSource, AiToolProgressEvent } from "../ai-read-tools.js";
import type { QueryInputValidationError } from "../query-security.js";
import type { QueryLifecycleQuery } from "../query-lifecycle.js";
import type { CreateAiQueryTestToolsOptions, AiQueryTestRepository, AiQueryTestResult } from "./query-test-schema.js";

export type RuntimeWithToolCallId = ToolRuntime & { toolCallId?: string };

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

export async function withToolEvents<T>(
  runtime: RuntimeWithToolCallId,
  onToolEvent: CreateAiQueryTestToolsOptions["onToolEvent"],
  execute: (emit: (event: AiToolProgressEvent) => Promise<void>, toolCallId: string) => Promise<T>,
): Promise<T> {
  const toolCallId = runtime.toolCallId ?? crypto.randomUUID();
  const emit = async (event: AiToolProgressEvent) => {
    try {
      await onToolEvent?.(event);
    } catch {
      /* UI progress failures must not change query results. */
    }
  };
  await emit({ type: "tool_start", toolCallId, toolName: "test_query" });
  let ok = false;
  try {
    const result = await execute(emit, toolCallId);
    ok = !(
      result &&
      typeof result === "object" &&
      "ok" in result &&
      (result as { ok?: unknown }).ok === false
    );
    return result;
  } finally {
    if (!runtime.signal?.aborted)
      await emit({ type: "tool_result", toolCallId, toolName: "test_query", ok });
  }
}

export function sameSourceTarget(left: AiReadSource, right: AiReadSource): boolean {
  return (
    left.id === right.id &&
    left.connection.host === right.connection.host &&
    left.connection.port === right.connection.port &&
    left.connection.database === right.connection.database &&
    left.connection.user === right.connection.user &&
    left.connection.password === right.connection.password
  );
}

export function validationResult(
  error: QueryInputValidationError,
): Record<string, unknown> {
  if (error.code === "MISSING_PARAMETERS") {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      askUser: true,
      retryable: false,
      instruction:
        "Pergunte ao administrador pelos valores dos parâmetros obrigatórios. Não invente valores nem execute novas tentativas até receber a resposta.",
    };
  }
  return {
    ok: false,
    code: error.code,
    message: error.message,
    askUser: false,
    retryable: false,
    instruction:
      "Corrija o rascunho com base no erro e no esquema verificado antes de testar novamente. Não repita uma versão idêntica sem mudança fundamentada.",
  };
}

export function classifiedQueryFailure(classified: ExternalQueryExecutionError): Record<string, unknown> {
    return {
      ok: false,
      code:
        classified.category === "timeout"
          ? "QUERY_TIMEOUT"
          : classified.category === "connection"
            ? "DATA_SOURCE_UNAVAILABLE"
            : "SQL_REJECTED",
      sqlState: classified.sqlState,
      message: classified.message,
      retryable: classified.retryable,
      askUser: false,
      instruction: classified.retryable
        ? "O servidor apresentou uma falha de transporte. Já foi aplicado no máximo um retry técnico; informe o administrador se persistir."
        : classified.category === "timeout"
          ? "Não repita a mesma consulta automaticamente após timeout. Simplifique filtros/agregações ou peça orientação ao administrador."
          : "Revise o esquema e os contextos consultados e corrija o SQL. Erros determinísticos e de permissão não devem ser repetidos sem alteração.",
    };
}

type QueryTarget = Pick<QueryLifecycleQuery, "id" | "dataSourceId" | "name" | "updatedAt">;
type SourceVersion = { updatedAt: Date; targetHash: string };

/** Revalida fonte/query após a consulta. Retorna falha (descartando a amostra) ou o alvo final da query. */
export async function recheckAfterQuery(
  repository: AiQueryTestRepository,
  dataSourceId: string,
  currentSource: AiReadSource,
  sourceVersion: SourceVersion,
  queryTarget: QueryTarget | undefined,
): Promise<{ failure: Record<string, unknown> } | { finalQueryTarget: QueryTarget | undefined }> {
  let finalSource: AiReadSource | undefined;
  try {
    finalSource = await repository.findSource(dataSourceId);
  } catch {
    return { failure: {
      ok: false,
      code: "DATA_SOURCE_CHANGED",
      message:
        "Não foi possível confirmar a configuração do servidor após a consulta. Descartei a amostra; atualize a tela e tente novamente.",
      retryable: false,
    } };
  }
  if (!finalSource || !sameSourceTarget(currentSource, finalSource)) {
    return { failure: {
      ok: false,
      code: "DATA_SOURCE_CHANGED",
      message:
        "A configuração do servidor mudou durante a consulta. Descartei a amostra; atualize os contextos e gere uma nova prévia.",
      retryable: false,
    } };
  }
  const finalSourceVersion = await repository.findSourceVersion(dataSourceId);
  if (
    !finalSourceVersion ||
    finalSourceVersion.updatedAt.getTime() !== sourceVersion.updatedAt.getTime() ||
    finalSourceVersion.targetHash !== sourceVersion.targetHash
  ) {
    return { failure: {
      ok: false,
      code: "DATA_SOURCE_CHANGED",
      message: "O servidor mudou durante a consulta. Descartei a amostra; gere uma nova prévia.",
      retryable: false,
    } };
  }

  let finalQueryTarget: typeof queryTarget = queryTarget;
  if (queryTarget) {
    finalQueryTarget = await repository.findQueryTarget(queryTarget.id);
    if (!finalQueryTarget || finalQueryTarget.updatedAt.getTime() !== queryTarget.updatedAt.getTime()) {
      return { failure: {
        ok: false,
        code: "QUERY_CHANGED",
        message: "A query mudou durante a consulta. Descartei a amostra; leia a versão atual e gere uma nova prévia.",
        retryable: false,
      } };
    }
  }
  return { finalQueryTarget };
}

type PreviewInput = z.infer<typeof inputSchema>;

export function buildQueryPreview(
  input: PreviewInput, source: AiReadSource, finalQueryTarget: Pick<QueryLifecycleQuery, "id" | "name" | "updatedAt"> | undefined,
  result: AiQueryTestResult, testRunId: string, toolCallId: string,
): { previewEvent: AiToolProgressEvent; payload: Record<string, unknown> } {
    const intent = {
      mode: input.mode,
      ...(finalQueryTarget ? {
        queryId: finalQueryTarget.id,
        queryName: input.queryName ?? finalQueryTarget.name,
        queryUpdatedAt: finalQueryTarget.updatedAt.toISOString(),
      } : {
        queryName: input.queryName ?? "Consulta gerada pela IA",
      }),
    };
    const previewEvent: AiToolProgressEvent = {
      type: "query_preview",
      toolCallId,
      testRunId,
      dataSource: { id: source.id, name: source.name },
      purpose: input.purpose,
      intent,
      sqlText: input.sqlText,
      parameters: input.parameters,
      testValues: input.values,
      rows: result.rows,
      rowCount: result.rows.length,
      rowLimit: result.rowLimit,
      byteLimit: result.byteLimit,
      bytes: result.bytes,
      truncated: result.truncated,
      truncationReason: result.truncationReason,
    };
    const payload = {
      ok: true,
      testRunId,
      dataSource: { id: source.id, name: source.name },
      purpose: input.purpose,
      intent,
      sqlText: input.sqlText,
      parameters: input.parameters,
      testValues: input.values,
      rowCount: result.rows.length,
      rows: result.rows,
      rowLimit: result.rowLimit,
      byteLimit: result.byteLimit,
      bytes: result.bytes,
      truncated: result.truncated,
      truncationReason: result.truncationReason,
      instruction: input.purpose === "dashboard"
        ? "Esta query é uma etapa solicitada para montar um dashboard. Apresente a prévia e aguarde a confirmação explícita no cartão; depois do salvamento, continue a proposta de dashboard pendente."
        : "Esta é uma consulta rápida sem etapa de dashboard solicitada. Apresente a prévia e aguarde a confirmação explícita antes de salvar; depois do salvamento, apenas confirme a conclusão e não inicie automaticamente uma proposta de dashboard.",
    };
  return { previewEvent, payload };
}
