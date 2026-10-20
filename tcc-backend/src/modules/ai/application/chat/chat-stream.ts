import { streamSSE } from "hono/streaming";

import type { AiToolProgressEvent } from "../tools/ai-read-tools.js";
import type {
  AiChatAgent,
  ResolvedAiConfiguration,
} from "../agent/ai-agent.js";
import { extractText } from "./chat-intents.js";
import type { AiChatMessages, AiChatRequest } from "./chat-schemas.js";
import {
  makeEvent,
  safeAiErrorDetails,
  safeProviderError,
  structuredResponseFallback,
} from "./chat-stream/helpers.js";
import type {
  AiChatHandlerContext,
  AiChatProgressPhase,
  AiSseEvent,
  ChatStreamHooks,
} from "./chat-stream/types.js";
import { buildVisibleChunks } from "./chat-stream/visible-chunks.js";

export {
  errorFromBody,
  makeEvent,
  readBoundedJson,
  safeAiErrorDetails,
  safeProviderError,
  structuredResponseFallback,
} from "./chat-stream/helpers.js";
export type {
  AiChatHandlerContext,
  AiChatProgressPhase,
  AiSseEvent,
  ChatStreamHooks,
} from "./chat-stream/types.js";

export function runChatStream(options: {
  context: AiChatHandlerContext;
  parsedBody: AiChatRequest;
  configuration: Extract<ResolvedAiConfiguration, { enabled: true }>;
  agent: AiChatAgent;
  now: () => number;
  requestId: string;
  messageId: string;
  hooks: ChatStreamHooks;
}) {
  const {
    context,
    parsedBody,
    configuration,
    agent,
    now,
    requestId,
    messageId,
    hooks,
  } = options;
  return streamSSE(context, async (stream) => {
    const startedAt = now();
    let writeQueue = Promise.resolve();
    let hasVisibleResponse = false;
    let hasStructuredResponse = false;
    let toolCallCount = 0;
    let lastToolName: string | undefined;
    let lastToolCallId: string | undefined;
    let lastToolResultOk: boolean | undefined;
    let latestStructuredEvent: AiToolProgressEvent | undefined;
    let structuredEventToolCallId: string | undefined;
    let requestStructuredStop: () => void = () => undefined;
    let pendingModelText: string[] = [];
    let progressPhase: AiChatProgressPhase = "waiting_for_model";
    let progressToolName: string | undefined;
    let progressInterval: ReturnType<typeof setInterval> | undefined;
    hooks.resetAiResponseBuffer = () => {
      pendingModelText = [];
    };
    hooks.enqueueToolEvent = (event) => {
      if (stream.aborted) return;
      if (event.type === "tool_start") {
        toolCallCount += 1;
        lastToolName = event.toolName;
        lastToolCallId = event.toolCallId;
        lastToolResultOk = undefined;
        progressPhase = "running_tool";
        progressToolName = event.toolName;
      } else if (event.type === "tool_result") {
        if (event.toolCallId === lastToolCallId) lastToolResultOk = event.ok;
        progressPhase = "waiting_for_model";
        progressToolName = undefined;
      }
      // Keep intermediate model narration out of the transcript. The tool cards already
      // show progress; only text produced after the last tool call is a final answer.
      if (
        event.type === "tool_start" ||
        event.type === "query_preview" ||
        event.type === "dashboard_preview" ||
        event.type === "dashboard_applied" ||
        event.type === "context_proposal" ||
        event.type === "questionnaire"
      )
        pendingModelText = [];
      if (
        event.type === "query_preview" ||
        event.type === "dashboard_preview" ||
        event.type === "dashboard_applied" ||
        event.type === "context_proposal" ||
        event.type === "questionnaire"
      ) {
        hasStructuredResponse = true;
        latestStructuredEvent = event;
        structuredEventToolCallId =
          "toolCallId" in event ? event.toolCallId : undefined;
      }
      const eventWrite = writeQueue.then(() =>
        stream.writeSSE(
          makeEvent({
            version: 1,
            ...event,
          }),
        ),
      );
      writeQueue = eventWrite;
      if (
        event.type === "tool_result" &&
        event.ok &&
        event.toolCallId === structuredEventToolCallId
      )
        return eventWrite.then(() => requestStructuredStop());
      return writeQueue;
    };
    const writeSse = (event: AiSseEvent) => {
      writeQueue = writeQueue.then(() => stream.writeSSE(makeEvent(event)));
      return writeQueue;
    };
    const writeProgress = () =>
      writeSse({
        version: 1,
        type: "progress",
        requestId,
        phase: progressPhase,
        elapsedMs: now() - startedAt,
        ...(progressToolName ? { toolName: progressToolName } : {}),
      });
    const abortController = new AbortController();
    let structuredStopRequested = false;
    let resolveStructuredCompletion!: () => void;
    const structuredCompletion = new Promise<"structured_complete">(
      (resolve) => {
        resolveStructuredCompletion = () => resolve("structured_complete");
      },
    );
    requestStructuredStop = () => {
      if (structuredStopRequested) return;
      structuredStopRequested = true;
      abortController.abort();
      resolveStructuredCompletion();
    };
    let clientDisconnected = false;
    let resolveClientAbort!: () => void;
    const clientAbort = new Promise<"client_abort">((resolve) => {
      resolveClientAbort = () => resolve("client_abort");
    });
    const abort = () => {
      clientDisconnected = true;
      console.warn("[AI chat] client disconnected", {
        requestId,
        elapsedMs: now() - startedAt,
        phase: progressPhase,
        activeTool: progressToolName,
        toolCallCount,
        lastToolName,
      });
      abortController.abort();
      resolveClientAbort();
    };
    stream.onAbort(abort);
    const requestSignal = context.req.raw.signal;
    if (requestSignal.aborted) abort();
    else requestSignal.addEventListener("abort", abort, { once: true });

    let finishReason: string | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let resolveTimeout!: () => void;
    const timeout = new Promise<"timeout">((resolve) => {
      resolveTimeout = () => resolve("timeout");
    });
    try {
      await writeSse({ version: 1, type: "start", requestId, messageId });
      progressInterval = setInterval(() => {
        if (stream.aborted || clientDisconnected) return;
        void writeProgress().catch(() => undefined);
      }, 10_000);
      timeoutHandle = setTimeout(() => {
        abortController.abort();
        resolveTimeout();
      }, configuration.requestTimeoutMs);

      const streamOperation = (async (): Promise<
        "done" | "provider_error" | "client_abort" | "structured_complete"
      > => {
        try {
          // With a thread, the checkpointer already holds the full history (tool calls included).
          const messages = (
            parsedBody.threadId
              ? [parsedBody.messages[parsedBody.messages.length - 1]!]
              : parsedBody.messages
          ) as AiChatMessages;
          const tokenStream = await agent.stream(
            { messages },
            {
              streamMode: "messages",
              signal: abortController.signal,
            },
          );

          for await (const [chunk, metadata] of tokenStream) {
            if (structuredStopRequested) return "structured_complete";
            if (abortController.signal.aborted) return "client_abort";
            // LangChain createAgent currently emits model chunks from
            // `model_request`. Keep the older node names for compatible
            // LangGraph agent implementations; never forward tool-node data.
            if (
              metadata.langgraph_node !== "model_request" &&
              metadata.langgraph_node !== "model" &&
              metadata.langgraph_node !== "agent"
            )
              continue;
            const delta = extractText(chunk.content);
            if (delta) {
              pendingModelText.push(delta);
              progressPhase = "preparing_response";
              progressToolName = undefined;
            }
            const reason = chunk.response_metadata?.finish_reason;
            if (typeof reason === "string") finishReason = reason;
          }

          const visibleChunks = buildVisibleChunks(pendingModelText);
          for (const visibleDelta of visibleChunks) {
            hasVisibleResponse = true;
            await writeSse({
              version: 1,
              type: "token",
              messageId,
              delta: visibleDelta,
            });
          }
          if (structuredStopRequested) return "structured_complete";
          return abortController.signal.aborted ? "client_abort" : "done";
        } catch (reason) {
          if (structuredStopRequested) return "structured_complete";
          if (clientDisconnected) return "client_abort";
          console.error("[AI chat] agent execution failed", {
            requestId,
            elapsedMs: now() - startedAt,
            phase: progressPhase,
            activeTool: progressToolName,
            ...safeAiErrorDetails(reason, configuration.apiKey),
            toolCallCount,
            lastToolName,
            hasStructuredResponse,
          });
          return "provider_error";
        }
      })();
      const outcome = await Promise.race([
        streamOperation,
        timeout,
        clientAbort,
        structuredCompletion,
      ]);
      if (outcome === "client_abort" || clientDisconnected) return;
      if (outcome === "timeout") {
        console.error("[AI chat] provider stream timed out", {
          requestId,
          elapsedMs: now() - startedAt,
          phase: progressPhase,
          activeTool: progressToolName,
          toolCallCount,
          lastToolName,
        });
        await writeSse({
          version: 1,
          type: "error",
          code: "AI_TIMEOUT",
          message: "A IA demorou além do limite de tempo. Tente novamente.",
          retryable: true,
        });
        return;
      }
      if (outcome === "provider_error") {
        console.error("[AI chat] provider stream failed", {
          requestId,
          elapsedMs: now() - startedAt,
          phase: progressPhase,
          activeTool: progressToolName,
          toolCallCount,
          lastToolName,
        });
        await writeSse({
          version: 1,
          type: "error",
          code: "AI_PROVIDER_ERROR",
          message: safeProviderError,
          retryable: true,
        });
        return;
      }
      if (!hasVisibleResponse && hasStructuredResponse) {
        const fallback = structuredResponseFallback(latestStructuredEvent);
        if (fallback) {
          hasVisibleResponse = true;
          await writeSse({
            version: 1,
            type: "token",
            messageId,
            delta: fallback,
          });
        }
      }
      if (!hasVisibleResponse) {
        const failedQueryTest =
          lastToolName === "test_query" && lastToolResultOk === false;
        console.error("[AI chat] provider returned an empty response", {
          requestId,
          elapsedMs: now() - startedAt,
          phase: progressPhase,
          toolCallCount,
          lastToolName,
          lastToolResultOk,
          finishReason,
          hasStructuredResponse,
          latestStructuredEventType: latestStructuredEvent?.type,
        });
        await writeSse({
          version: 1,
          type: "token",
          messageId,
          delta: failedQueryTest
            ? "A validação da query falhou nesta tentativa. Ela não foi salva. Confira a etapa “Testando consulta” e tente novamente para corrigir a consulta."
            : lastToolName === "test_query" && lastToolResultOk === true
              ? "A query foi testada, mas a IA não concluiu a explicação. Confira a prévia no cartão; ela ainda não foi salva."
              : "As ferramentas terminaram, mas a IA não concluiu a resposta. Nenhuma alteração foi salva; tente novamente.",
        });
        await writeSse({
          version: 1,
          type: "error",
          code: "AI_EMPTY_RESPONSE",
          message: failedQueryTest
            ? "A validação da query falhou e a IA não conseguiu explicar o erro. Confira a etapa de teste e tente novamente."
            : "A IA não retornou uma resposta após concluir as ferramentas. Tente novamente.",
          retryable: true,
        });
        return;
      }
    } catch (reason) {
      if (!clientDisconnected && !stream.aborted) {
        console.error("[AI chat] SSE handler failed", {
          requestId,
          elapsedMs: now() - startedAt,
          phase: progressPhase,
          activeTool: progressToolName,
          ...safeAiErrorDetails(reason, configuration.apiKey),
          toolCallCount,
          lastToolName,
          hasStructuredResponse,
        });
        try {
          await writeSse({
            version: 1,
            type: "error",
            code: "AI_PROVIDER_ERROR",
            message: safeProviderError,
            retryable: true,
          });
        } catch {
          // The client may have disconnected while the provider was failing.
        }
      }
    } finally {
      if (progressInterval !== undefined) clearInterval(progressInterval);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      requestSignal.removeEventListener("abort", abort);
    }

    if (
      !clientDisconnected &&
      !stream.aborted &&
      (!abortController.signal.aborted || structuredStopRequested)
    ) {
      try {
        await writeSse({ version: 1, type: "done", messageId, finishReason });
      } catch {
        // A disconnect after the final token should not cause an unhandled rejection.
      }
    }
  });
}
