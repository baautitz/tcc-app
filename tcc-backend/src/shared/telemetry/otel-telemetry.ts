import {
  SpanStatusCode,
  ROOT_CONTEXT,
  trace,
  type Attributes,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import {
  TracerProvider,
  SimpleSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace";
import {
  JsonlFileSpanExporter,
  NULL_ATTRIBUTES_KEY,
} from "./jsonl-span-exporter.js";
import {
  noopTelemetry,
  type TelemetryAttributes,
  type TelemetryPort,
  type TelemetrySpan,
} from "./telemetry-port.js";

class OtelSpan implements TelemetrySpan {
  private ended = false;
  private readonly nullNames = new Set<string>();

  constructor(
    private readonly tracer: Tracer,
    private readonly span: Span,
  ) {}

  get traceId() {
    return this.span.spanContext().traceId;
  }

  get spanId() {
    return this.span.spanContext().spanId;
  }

  setAttributes(attributes: TelemetryAttributes) {
    if (this.ended) return;
    const defined: Attributes = {};
    for (const [name, value] of Object.entries(attributes)) {
      if (value === undefined) continue;
      if (value === null) this.nullNames.add(name);
      else {
        this.nullNames.delete(name);
        defined[name] = value;
      }
    }
    this.span.setAttributes(defined);
  }

  child(name: string, attributes: TelemetryAttributes = {}) {
    const context = trace.setSpan(ROOT_CONTEXT, this.span);
    const child = new OtelSpan(
      this.tracer,
      this.tracer.startSpan(name, {}, context),
    );
    child.setAttributes(attributes);
    return child;
  }

  end(options?: { error?: string }) {
    if (this.ended) return;
    if (this.nullNames.size > 0)
      this.span.setAttribute(NULL_ATTRIBUTES_KEY, [...this.nullNames]);
    if (options?.error !== undefined)
      this.span.setStatus({
        code: SpanStatusCode.ERROR,
        message: options.error,
      });
    this.ended = true;
    this.span.end();
  }
}

export class OtelTelemetry implements TelemetryPort {
  readonly enabled = true;
  private readonly provider: TracerProvider;
  private readonly tracer: Tracer;

  constructor(exporter: SpanExporter) {
    this.provider = new TracerProvider({
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
    });
    this.tracer = this.provider.getTracer("tcc-backend");
  }

  startSpan(name: string, attributes: TelemetryAttributes = {}) {
    const span = new OtelSpan(
      this.tracer,
      this.tracer.startSpan(name, {}, ROOT_CONTEXT),
    );
    span.setAttributes(attributes);
    return span;
  }

  async shutdown() {
    await this.provider.shutdown();
  }
}

/** Sem `TELEMETRY_FILE`, devolve a implementação nula: nada é gravado. */
export function createTelemetry(options: { file?: string }): TelemetryPort {
  const file = options.file?.trim();
  if (!file) return noopTelemetry;
  return new OtelTelemetry(new JsonlFileSpanExporter(file));
}
