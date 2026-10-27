import type { AiToolProgressEvent } from "../../tools/ai-read-tools.js";
import { MAX_CHAT_REQUEST_BYTES } from "../chat-schemas.js";
import type { AiChatHandlerContext, AiSseEvent } from "./types.js";

export function errorFromBody(context: AiChatHandlerContext, message: string) {
  return context.json({ error: message, code: "AI_INVALID_REQUEST" }, 400);
}

export async function readBoundedJson(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; tooLarge: boolean }> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_CHAT_REQUEST_BYTES
  ) {
    return { ok: false, tooLarge: true };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, tooLarge: false };

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_CHAT_REQUEST_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The request may already have been closed by the client.
        }
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, tooLarge: false };
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return {
      ok: true,
      value: JSON.parse(new TextDecoder().decode(body)) as unknown,
    };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

export function makeEvent(event: AiSseEvent): {
  event: AiSseEvent["type"];
  data: string;
} {
  return { event: event.type, data: JSON.stringify(event) };
}

export function safeAiErrorDetails(reason: unknown, apiKey: string) {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  const candidate =
    reason && typeof reason === "object"
      ? (reason as {
          code?: unknown;
          status?: unknown;
          statusCode?: unknown;
          cause?: unknown;
        })
      : undefined;
  const redact = (value: string) =>
    value
      .split(apiKey)
      .join("[REDACTED]")
      .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
      .replace(/(api[_-]?key\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
      .slice(0, 1_000);
  const details: Record<string, unknown> = {
    name: error.name,
    message: redact(error.message),
  };
  if (
    typeof candidate?.code === "string" ||
    typeof candidate?.code === "number"
  ) {
    details.code = candidate.code;
  }
  const status = candidate?.status ?? candidate?.statusCode;
  if (typeof status === "string" || typeof status === "number") {
    details.status = status;
  }
  if (candidate?.cause instanceof Error) {
    details.cause = {
      name: candidate.cause.name,
      message: redact(candidate.cause.message),
    };
  }
  return details;
}

export const safeProviderError =
  "A IA não conseguiu concluir a resposta. Tente novamente.";

export function structuredResponseFallback(
  event: AiToolProgressEvent | undefined,
): string | undefined {
  if (!event) return undefined;
  switch (event.type) {
    case "query_preview": {
      const sampleStatus = event.truncated
        ? event.truncationReason === "row_limit"
          ? `A amostra foi truncada no limite de ${event.rowLimit} linhas.`
          : "A amostra foi truncada no limite de bytes."
        : "A amostra não atingiu o limite de linhas ou bytes.";
      const continuation =
        event.purpose === "dashboard"
          ? "Após salvar, continuarei a proposta de dashboard solicitada."
          : "Esta consulta é pontual; salvá-la não inicia uma proposta de dashboard automaticamente.";
      const operation =
        event.intent.mode === "update"
          ? "prévia de atualização da query"
          : "prévia da query";
      const pendingSave =
        event.intent.mode === "update"
          ? "A alteração ainda não foi salva."
          : "A query ainda não foi salva.";
      return event.rowCount === 0
        ? `A ${operation} “${event.intent.queryName}” foi testada, mas voltou sem linhas para os valores informados. ${pendingSave} Revise o SQL e os filtros no cartão antes de confirmar. ${continuation}`
        : `A ${operation} “${event.intent.queryName}” está no cartão, com ${event.rowCount} linha(s). ${sampleStatus} ${pendingSave} Revise o SQL e confirme no cartão. ${continuation}`;
    }
    case "dashboard_preview":
      return event.canCommit
        ? `A proposta do dashboard “${event.document.name}” está pronta para revisão. Ela ainda não foi salva; clique em “${event.mode === "create" ? "Criar dashboard" : "Aplicar alterações"}” no cartão para confirmar.`
        : `A proposta do dashboard “${event.document.name}” foi gerada, mas ainda tem ${event.issues.length} pendência(s) e não pode ser aplicada. Revise os problemas no cartão; nada foi salvo.`;
    case "component_preview":
      return `O componente “${event.component.title}” está isolado no cartão. Nada foi salvo; aprove ou peça ajuste no cartão para eu continuar.`;
    case "dashboard_required":
      return "Escolha um dashboard na janela aberta para eu continuar.";
    case "dashboard_applied":
      return `O patch no dashboard “${event.dashboardName}” foi aplicado e salvo.`;
    case "context_proposal":
      return "A proposta de contexto está pronta para revisão no cartão. O contexto ainda não foi alterado; use a ação de aprovação somente se quiser aplicá-la.";
    case "questionnaire":
      return `Responda ao formulário “${event.questionnaire.title}” acima para eu continuar.`;
    default:
      return undefined;
  }
}
