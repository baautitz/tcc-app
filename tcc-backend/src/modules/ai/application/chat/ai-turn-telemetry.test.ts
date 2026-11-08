import { Hono } from "hono";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import { describe, expect, it } from "vitest";
import type { AIMessageChunk } from "@langchain/core/messages";
import type { AuthenticatedUser } from "../../../identity/domain/auth-user.js";
import { OtelTelemetry } from "../../../../shared/telemetry/otel-telemetry.js";
import type { AiAgentToken, AiChatAgent } from "../agent/ai-agent.js";
import { AiChatService } from "./ai-chat.js";
import { AiTurnTelemetry } from "./ai-turn-telemetry.js";
import { AiReasoningFilter } from "./ai-reasoning-filter.js";

const configuration = {
  enabled: true as const,
  baseURL: "https://ai.example.test/v1",
  apiKey: "secret",
  model: "test-model",
  requestTimeoutMs: 60_000,
};

function run(agent: AiChatAgent, extra: { header?: string } = {}) {
  const exporter = new InMemorySpanExporter();
  const service = new AiChatService({
    getConfiguration: () => configuration,
    createAgent: () => agent,
    telemetry: new OtelTelemetry(exporter),
    participantFallback: "P09",
  });
  const app = new Hono<{ Variables: { currentUser: AuthenticatedUser } }>();
  app.use("*", async (context, next) => {
    context.set("currentUser", {
      id: "u",
      name: "Admin",
      email: "admin@example.test",
      isAdmin: true,
      permissions: [],
    });
    await next();
  });
  app.post("/chat", (context) => service.handle(context));
  const request = app.request("/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(extra.header ? { "X-Participant-Id": extra.header } : {}),
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: "oi" }],
      threadId: "11111111-1111-4111-8111-111111111111",
    }),
  });
  return { exporter, request };
}

describe("telemetria do turno do chat", () => {
  it("grava o span raiz com métricas do turno e a participante", async () => {
    const agent: AiChatAgent = {
      stream: async () =>
        (async function* () {
          yield [
            { content: "<think>pensando</think>Olá" } as AIMessageChunk,
            { langgraph_node: "model" },
          ] as AiAgentToken;
        })(),
    };
    const { exporter, request } = run(agent, { header: "P03" });
    const response = await request;
    await response.text();

    const spans = exporter.getFinishedSpans();
    const root = spans.find((span) => span.name === "ai.turn")!;
    expect(root.attributes).toMatchObject({
      model: "test-model",
      participant: "P03",
      result: "ok",
      thinking_chars: 8,
      thinking_text: "pensando",
      response_text: "Olá",
      user_message: "oi",
      thinking_blocks: 1,
      tool_calls_count: 0,
      test_query_failures: 0,
      generated_sql: [],
    });
    expect(typeof root.attributes.L_total_ms).toBe("number");
    expect(typeof root.attributes.TTFT_ms).toBe("number");
    expect(root.attributes["telemetry.null_attributes"]).toEqual(
      expect.arrayContaining(["tokens_total", "schema_valid_first_try"]),
    );
  });

  it("marca o resultado erro quando o provedor falha", async () => {
    const agent: AiChatAgent = {
      stream: async () => {
        throw new Error("boom");
      },
    };
    const { exporter, request } = run(agent);
    await (await request).text();
    const root = exporter.getFinishedSpans().find((s) => s.name === "ai.turn")!;
    expect(root.attributes.result).toBe("erro");
    expect(root.attributes.participant).toBe("P09");
  });
});

describe("AiReasoningFilter (medidas)", () => {
  it("soma tempo e caracteres de vários blocos e detecta tags partidas", () => {
    let time = 0;
    const filter = new AiReasoningFilter({ clock: () => time });
    expect(filter.push("a<thi")).toBe("a");
    time = 100;
    filter.push("nk>abc");
    time = 250;
    expect(filter.push("de</think>b<think>x")).toBe("b");
    time = 300;
    filter.finish();
    expect(filter.thinkingBlocks).toBe(2);
    expect(filter.thinkingChars).toBe(6);
    expect(filter.thinkingMs).toBe(150 + 50);
    expect(filter.thinkingText).toBe("abcde\n\nx");
  });
});

describe("AiTurnTelemetry (callbacks do LangChain)", () => {
  it("cria spans filhos de LLM e ferramentas e consolida tokens e SQL", async () => {
    const exporter = new InMemorySpanExporter();
    const turn = new AiTurnTelemetry(new OtelTelemetry(exporter), {
      turnId: "t",
      model: "m",
      now: Date.now,
    });
    const handler = turn.callbacks[0] as unknown as Record<
      string,
      (...args: unknown[]) => Promise<void> | void
    >;
    await handler.handleChatModelStart!({ id: ["x"] }, [], "llm1");
    turn.onStreamMessage({
      type: "ai",
      usage_metadata: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        output_token_details: { reasoning: 3 },
      },
    });
    await handler.handleLLMEnd!({ generations: [[{}]] }, "llm1");
    await handler.handleToolStart!(
      { id: ["t"] },
      JSON.stringify({ sqlText: "SELECT 1" }),
      "tool1",
      undefined,
      undefined,
      undefined,
      "test_query",
      "call-1",
    );
    await handler.handleToolEnd!({ content: '{"ok":false}' }, "tool1");
    await handler.handleToolStart!(
      { id: ["t"] },
      "{}",
      "tool2",
      undefined,
      undefined,
      undefined,
      "preview_component",
      "call-2",
    );
    await handler.handleToolEnd!({ content: '{"ok":true}' }, "tool2");
    turn.onStreamMessage({
      type: "tool",
      name: "test_query",
      tool_call_id: "call-3",
      content: '{"ok":false,"code":"QUERY_PREFLIGHT_REQUIRED"}',
    });
    turn.onStreamMessage({
      type: "tool",
      name: "test_query",
      tool_call_id: "call-1",
      content: '{"ok":false}',
    });
    turn.finish("ok");

    const spans = exporter.getFinishedSpans();
    const root = spans.find((span) => span.name === "ai.turn")!;
    expect(root.attributes).toMatchObject({
      tool_calls_count: 3,
      test_query_failures: 2,
      tokens_input: 10,
      tokens_output: 5,
      tokens_total: 15,
      tokens_reasoning: 3,
      schema_valid_first_try: true,
      generated_sql: ["SELECT 1"],
    });
    const tool = spans.find((span) => span.name === "ai.tool.test_query")!;
    expect(tool.attributes).toMatchObject({ ok: false, toolCallId: "call-1" });
    expect(new Set(spans.map((s) => s.spanContext().traceId)).size).toBe(1);
  });

  it("detecta entrada recusada pelo schema na primeira chamada", () => {
    const exporter = new InMemorySpanExporter();
    const turn = new AiTurnTelemetry(new OtelTelemetry(exporter), {
      turnId: "t",
      model: "m",
      now: Date.now,
    });
    turn.onStreamMessage({
      type: "tool",
      name: "create_or_update_dashboard",
      status: "error",
      content: "Received tool input did not match expected schema",
    });
    turn.finish("ok");
    const spans = exporter.getFinishedSpans();
    expect(
      spans.find((s) => s.name === "ai.turn")!.attributes
        .schema_valid_first_try,
    ).toBe(false);
    expect(
      spans.find((s) => s.name === "ai.tool.create_or_update_dashboard")!
        .attributes.rejection_message,
    ).toContain("did not match expected schema");
  });
  it("não conta como recusa a pausa do turno para aprovação (AbortError após resultado ok)", async () => {
    const exporter = new InMemorySpanExporter();
    const turn = new AiTurnTelemetry(new OtelTelemetry(exporter), {
      turnId: "t",
      model: "m",
      now: Date.now,
    });
    const handler = turn.callbacks[0] as unknown as Record<
      string,
      (...args: unknown[]) => Promise<void> | void
    >;
    for (const [run, name, call] of [
      ["r1", "test_query", "c1"],
      ["r2", "preview_component", "c2"],
    ] as const) {
      await handler.handleToolStart!(
        { id: ["t"] },
        "{}",
        run,
        undefined,
        undefined,
        undefined,
        name,
        call,
      );
      await handler.handleToolError!(
        new DOMException("This operation was aborted", "AbortError"),
        run,
      );
    }
    turn.finish("ok");

    const spans = exporter.getFinishedSpans();
    const root = spans.find((s) => s.name === "ai.turn")!;
    expect(root.attributes).toMatchObject({
      schema_valid_first_try: true,
      test_query_failures: 0,
    });
    const tool = spans.find((s) => s.name === "ai.tool.preview_component")!;
    expect(tool.attributes).toMatchObject({ ok: true, paused_for_user: true });
  });

  it("exceção comum da ferramenta continua contando como falha", async () => {
    const exporter = new InMemorySpanExporter();
    const turn = new AiTurnTelemetry(new OtelTelemetry(exporter), {
      turnId: "t",
      model: "m",
      now: Date.now,
    });
    const handler = turn.callbacks[0] as unknown as Record<
      string,
      (...args: unknown[]) => Promise<void> | void
    >;
    await handler.handleToolStart!(
      { id: ["t"] },
      "{}",
      "r1",
      undefined,
      undefined,
      undefined,
      "preview_component",
      "c1",
    );
    await handler.handleToolError!(new Error("falhou"), "r1");
    turn.finish("ok");
    expect(
      exporter.getFinishedSpans().find((s) => s.name === "ai.turn")!.attributes
        .schema_valid_first_try,
    ).toBe(false);
  });
});
