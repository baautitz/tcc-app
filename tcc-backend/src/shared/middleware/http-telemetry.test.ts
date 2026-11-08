import { Hono } from "hono";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import { expect, it } from "vitest";
import { OtelTelemetry } from "../telemetry/otel-telemetry.js";
import {
  definitionAttributes,
  httpTelemetry,
  queryRowsAttributes,
} from "./http-telemetry.js";

it("registra bytes, linhas e a definição sem alterar a resposta", async () => {
  const exporter = new InMemorySpanExporter();
  const telemetry = new OtelTelemetry(exporter);
  const app = new Hono();
  app.use(
    "/query/:uuid",
    httpTelemetry(telemetry, "http.dashboard.query", {
      attributes: (p) => ({ queryUuid: p.uuid }),
      inspect: queryRowsAttributes,
    }),
  );
  app.use(
    "/d/:id",
    httpTelemetry(telemetry, "http.dashboard.definition", {
      inspect: definitionAttributes,
    }),
  );
  app.get("/query/:uuid", (c) => c.json({ rows: [{ a: 1 }, { a: 2 }] }));
  app.get("/d/:id", (c) =>
    c.json({ definition: { queryBindings: [{ queryUuid: "q1" }] } }),
  );

  const response = await app.request("/query/abc");
  expect(await response.json()).toEqual({ rows: [{ a: 1 }, { a: 2 }] });
  await app.request("/d/1");

  const [query, definition] = exporter.getFinishedSpans();
  expect(query!.attributes).toMatchObject({
    queryUuid: "abc",
    status: 200,
    row_count: 2,
    response_bytes: JSON.stringify({ rows: [{ a: 1 }, { a: 2 }] }).length,
  });
  expect(definition!.attributes).toMatchObject({
    query_uuids: ["q1"],
    query_count: 1,
  });
});
