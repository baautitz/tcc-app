// Porta de telemetria: o domínio e a aplicação dependem só desta interface,
// nunca de @opentelemetry/*. A implementação fica em otel-telemetry.ts.

/** Valores aceitos como atributo (regra do OpenTelemetry: primitivos ou arrays de primitivos). */
export type TelemetryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | string[]
  | number[]
  | boolean[];

export type TelemetryAttributes = Record<string, TelemetryValue>;

export interface TelemetrySpan {
  readonly traceId: string;
  readonly spanId: string;
  setAttributes(attributes: TelemetryAttributes): void;
  /** Cria um span filho (mesmo traceId). */
  child(name: string, attributes?: TelemetryAttributes): TelemetrySpan;
  /** Encerra o span; `error` marca o status como erro. Chamadas repetidas são ignoradas. */
  end(options?: { error?: string }): void;
}

export interface TelemetryPort {
  readonly enabled: boolean;
  startSpan(name: string, attributes?: TelemetryAttributes): TelemetrySpan;
  shutdown(): Promise<void>;
}

const noopSpan: TelemetrySpan = {
  traceId: "",
  spanId: "",
  setAttributes: () => undefined,
  child: () => noopSpan,
  end: () => undefined,
};

/** Usada quando TELEMETRY_FILE não está definida: nada é gravado. */
export const noopTelemetry: TelemetryPort = {
  enabled: false,
  startSpan: () => noopSpan,
  shutdown: async () => undefined,
};
