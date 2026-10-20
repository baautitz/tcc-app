import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { tool } from "@langchain/core/tools";
import { createAgent as createLangChainAgent } from "langchain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAiModel, resolveAiConfiguration } from "./agent/ai-agent.js";

type ProviderRequest = {
  model: string;
  messages: Array<{
    role: string;
    content?: string | null;
    tool_calls?: unknown[];
  }>;
  tools?: Array<{ function?: { name?: string } }>;
  stream?: boolean;
};

type ProviderResponse = {
  choices: Array<{
    index: number;
    delta: Record<string, unknown>;
    finish_reason: string | null;
  }>;
};

type ProviderFixtureReply =
  | { kind: "stream"; chunks: ProviderResponse[] }
  | { kind: "json"; body: unknown };

type ProviderFixture = {
  baseURL: string;
  requests: ProviderRequest[];
  authorizationHeaders: string[];
  close: () => Promise<void>;
};

function streamChunk(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
): ProviderResponse {
  return { choices: [{ index: 0, delta, finish_reason: finishReason }] };
}

async function bodyJson(request: IncomingMessage): Promise<ProviderRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as ProviderRequest;
}

async function sendOpenAiStream(
  response: ServerResponse,
  chunks: ProviderResponse[],
) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  chunks.forEach((chunk, index) => {
    response.write(
      `data: ${JSON.stringify({
        id: `chatcmpl-fixture-${index}`,
        object: "chat.completion.chunk",
        created: 1,
        model: "fixture-model",
        ...chunk,
      })}\n\n`,
    );
  });
  response.end("data: [DONE]\n\n");
}

async function createProviderFixture(
  respond: (request: ProviderRequest, index: number) => ProviderFixtureReply,
): Promise<ProviderFixture> {
  const requests: ProviderRequest[] = [];
  const authorizationHeaders: string[] = [];
  const server: Server = createServer((incoming, outgoing) => {
    void (async () => {
      if (
        incoming.method !== "POST" ||
        incoming.url !== "/v1/chat/completions"
      ) {
        outgoing.writeHead(404).end();
        return;
      }
      const body = await bodyJson(incoming);
      authorizationHeaders.push(String(incoming.headers.authorization ?? ""));
      const requestIndex = requests.push(body) - 1;
      const reply = respond(body, requestIndex);
      if (reply.kind === "stream")
        await sendOpenAiStream(outgoing, reply.chunks);
      else {
        outgoing.writeHead(200, { "content-type": "application/json" });
        outgoing.end(JSON.stringify(reply.body));
      }
    })().catch((error: unknown) => {
      outgoing
        .writeHead(500)
        .end(error instanceof Error ? error.message : "fixture failed");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Local provider fixture did not bind a TCP port.");
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    requests,
    authorizationHeaders,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

describe("integração LangChain com provider OpenAI-compatible local", () => {
  let fixture: ProviderFixture | undefined;

  afterEach(async () => {
    await fixture?.close();
    fixture = undefined;
  });

  it("transmite tokens através da URL-base configurada com a chave somente no backend", async () => {
    fixture = await createProviderFixture((request) => {
      if (!request.stream)
        throw new Error("LangChain should request a streaming completion.");
      return {
        kind: "stream",
        chunks: [
          streamChunk({ content: "Pedidos encontrados: " }),
          streamChunk({ content: "12" }),
          streamChunk({}, "stop"),
        ],
      };
    });
    const configuration = resolveAiConfiguration({
      AI_BASE_URL: fixture.baseURL,
      AI_API_KEY: "fixture-server-secret",
      AI_MODEL: "fixture-model",
      AI_REQUEST_TIMEOUT_MS: "5000",
    });
    if (!configuration.enabled)
      throw new Error(
        "The local provider fixture configuration should be valid.",
      );

    const model = createAiModel(configuration);
    const output: string[] = [];
    const stream = await model.stream([
      { role: "user", content: "Leia pedidos." },
    ]);
    for await (const chunk of stream) {
      if (typeof chunk.content === "string") output.push(chunk.content);
    }
    expect(output.join("")).toContain("Pedidos encontrados: 12");
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0]).toMatchObject({
      model: "fixture-model",
      stream: true,
    });
    expect(fixture.authorizationHeaders).toEqual([
      "Bearer fixture-server-secret",
    ]);
  });

  it("executa uma tool call e envia o resultado ao provider no ciclo seguinte", async () => {
    fixture = await createProviderFixture((_request, index) => ({
      kind: "json",
      body: {
        id: `chatcmpl-fixture-tool-${index}`,
        object: "chat.completion",
        created: 1,
        model: "fixture-model",
        choices: [
          {
            index: 0,
            message:
              index === 0
                ? {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: "call_lookup_1",
                        type: "function",
                        function: {
                          name: "lookup_orders",
                          arguments: '{"table":"orders"}',
                        },
                      },
                    ],
                  }
                : { role: "assistant", content: "Pedidos encontrados: 12" },
            finish_reason: index === 0 ? "tool_calls" : "stop",
          },
        ],
      },
    }));
    const configuration = resolveAiConfiguration({
      AI_BASE_URL: fixture.baseURL,
      AI_API_KEY: "fixture-server-secret",
      AI_MODEL: "fixture-model",
    });
    if (!configuration.enabled)
      throw new Error(
        "The local provider fixture configuration should be valid.",
      );
    const lookup = vi.fn(
      async ({ table }: { table: string }) => `resultado de ${table}`,
    );
    const lookupTool = tool(lookup, {
      name: "lookup_orders",
      description: "Busca dados de uma tabela já autorizada.",
      schema: z.object({ table: z.string() }),
    });

    const agent = createLangChainAgent({
      model: createAiModel(configuration),
      tools: [lookupTool],
      systemPrompt: "Use a ferramenta quando ela responder à pergunta.",
    });
    const result = await agent.invoke({
      messages: [{ role: "user", content: "Leia pedidos." }],
    });

    expect(result.messages.at(-1)?.content).toBe("Pedidos encontrados: 12");
    expect(lookup).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledWith({ table: "orders" }, expect.anything());
    expect(fixture.requests).toHaveLength(2);
    expect(fixture.requests[0]).toMatchObject({
      model: "fixture-model",
      stream: false,
      tools: [{ function: { name: "lookup_orders" } }],
    });
    expect(
      fixture.requests[1]?.messages.some((message) => message.role === "tool"),
    ).toBe(true);
    expect(fixture.authorizationHeaders).toEqual([
      "Bearer fixture-server-secret",
      "Bearer fixture-server-secret",
    ]);
  });
});
