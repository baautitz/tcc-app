import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import { describe, expect, it } from "vitest";
import { OtelTelemetry, createTelemetry } from "./otel-telemetry.js";
import { spanToJsonLine } from "./jsonl-span-exporter.js";
import { resolveParticipant } from "./participant.js";

describe("OtelTelemetry", () => {
  it("cria span raiz e filhos com o mesmo traceId e preserva null", () => {
    const exporter = new InMemorySpanExporter();
    const telemetry = new OtelTelemetry(exporter);
    const root = telemetry.startSpan("ai.turn", { turnId: "t1", tokens: null });
    const child = root.child("ai.tool.test_query", { ok: true });
    child.end();
    root.end();

    const [first, second] = exporter.getFinishedSpans();
    expect(first!.name).toBe("ai.tool.test_query");
    expect(first!.parentSpanContext?.spanId).toBe(second!.spanContext().spanId);
    expect(first!.spanContext().traceId).toBe(second!.spanContext().traceId);
    const line = JSON.parse(spanToJsonLine(second!));
    expect(line.attributes).toEqual({ turnId: "t1", tokens: null });
    expect(line.parentSpanId).toBeNull();
  });

  it("sem arquivo configurado devolve a telemetria nula", () => {
    const telemetry = createTelemetry({});
    expect(telemetry.enabled).toBe(false);
    expect(telemetry.startSpan("x").child("y").traceId).toBe("");
  });

  it("grava uma linha JSON por span no arquivo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "telemetry-"));
    try {
      const file = join(dir, "sub", "ai.jsonl");
      const telemetry = createTelemetry({ file });
      const span = telemetry.startSpan("a", { n: 1 });
      span.child("b").end();
      span.end();
      await telemetry.shutdown();
      const lines = (await readFile(file, "utf8")).trim().split("\n");
      expect(lines.map((line) => JSON.parse(line).name)).toEqual(["b", "a"]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("aceita só identificadores opacos de participante", () => {
    expect(resolveParticipant("P01", undefined)).toBe("P01");
    expect(resolveParticipant("ana@x.com", "P02")).toBe("P02");
    expect(resolveParticipant(undefined, undefined)).toBeUndefined();
  });
});
