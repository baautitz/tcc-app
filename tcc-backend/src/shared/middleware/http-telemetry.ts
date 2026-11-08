import type { MiddlewareHandler } from "hono";
import {
  PARTICIPANT_HEADER,
  resolveParticipant,
} from "../telemetry/participant.js";
import type {
  TelemetryAttributes,
  TelemetryPort,
} from "../telemetry/telemetry-port.js";

type BodyInspector = (body: unknown) => TelemetryAttributes;

/**
 * Um span por requisição HTTP (L_dashboard): duração, status e bytes da resposta.
 * `inspect` extrai atributos do corpo JSON (ex.: número de linhas). Sem telemetria ligada, é um no-op.
 */
export function httpTelemetry(
  telemetry: TelemetryPort,
  spanName: string,
  options: {
    participantFallback?: string;
    attributes?: (path: Record<string, string>) => TelemetryAttributes;
    inspect?: BodyInspector;
  } = {},
): MiddlewareHandler {
  return async (context, next) => {
    if (!telemetry.enabled || context.req.method !== "GET") return next();
    const span = telemetry.startSpan(spanName, {
      participant:
        resolveParticipant(
          context.req.header(PARTICIPANT_HEADER),
          options.participantFallback,
        ) ?? null,
      ...options.attributes?.(context.req.param()),
    });
    try {
      await next();
      const response = context.res.clone();
      const text = await response.text();
      let extra: TelemetryAttributes = {};
      if (options.inspect && response.ok) {
        try {
          extra = options.inspect(JSON.parse(text));
        } catch {
          extra = {};
        }
      }
      span.setAttributes({
        status: context.res.status,
        response_bytes: Buffer.byteLength(text),
        ...extra,
      });
      span.end(context.res.status >= 500 ? { error: "http_5xx" } : undefined);
    } catch (error) {
      span.end({ error: "exception" });
      throw error;
    }
  };
}

export function definitionAttributes(body: unknown): TelemetryAttributes {
  const bindings = (
    body as { definition?: { queryBindings?: { queryUuid?: unknown }[] } }
  )?.definition?.queryBindings;
  const uuids = (bindings ?? [])
    .map((binding) => binding.queryUuid)
    .filter((uuid): uuid is string => typeof uuid === "string");
  return { query_uuids: [...new Set(uuids)], query_count: new Set(uuids).size };
}

export function queryRowsAttributes(body: unknown): TelemetryAttributes {
  const rows = (body as { rows?: unknown })?.rows;
  return { row_count: Array.isArray(rows) ? rows.length : null };
}
