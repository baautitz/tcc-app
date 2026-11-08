import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";

/** Atributo interno do adaptador: nomes dos atributos que valem `null`. */
export const NULL_ATTRIBUTES_KEY = "telemetry.null_attributes";

const hrToMs = (time: [number, number]) => time[0] * 1_000 + time[1] / 1e6;

export function spanToJsonLine(span: ReadableSpan): string {
  const { [NULL_ATTRIBUTES_KEY]: nullNames, ...attributes } = span.attributes;
  const restored: Record<string, unknown> = { ...attributes };
  if (Array.isArray(nullNames))
    for (const name of nullNames) restored[String(name)] = null;
  const context = span.spanContext();
  return JSON.stringify({
    traceId: context.traceId,
    spanId: context.spanId,
    parentSpanId: span.parentSpanContext?.spanId ?? null,
    name: span.name,
    startTime: new Date(hrToMs(span.startTime)).toISOString(),
    endTime: new Date(hrToMs(span.endTime)).toISOString(),
    durationMs: Math.round(hrToMs(span.duration) * 1000) / 1000,
    status: span.status.code === 2 ? "error" : "ok",
    ...(span.status.message ? { statusMessage: span.status.message } : {}),
    attributes: restored,
  });
}

/**
 * Exportador próprio: o SDK JS do OpenTelemetry só traz exportadores de console e
 * de memória, então cada span terminado vira uma linha JSON no arquivo local.
 */
export class JsonlFileSpanExporter implements SpanExporter {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    const payload = spans.map((span) => `${spanToJsonLine(span)}\n`).join("");
    this.queue = this.queue
      .then(async () => {
        await mkdir(dirname(this.filePath), { recursive: true });
        await appendFile(this.filePath, payload, "utf8");
        resultCallback({ code: ExportResultCode.SUCCESS });
      })
      .catch((error: unknown) => {
        console.error("[telemetry] falha ao gravar o arquivo JSONL");
        resultCallback({
          code: ExportResultCode.FAILED,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });
  }

  async shutdown(): Promise<void> {
    await this.queue;
  }

  async forceFlush(): Promise<void> {
    await this.queue;
  }
}
