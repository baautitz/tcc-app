import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { Serialized } from "@langchain/core/load/serializable";
import type { LLMResult } from "@langchain/core/outputs";
import type {
  TelemetryPort,
  TelemetrySpan,
} from "../../../../shared/telemetry/telemetry-port.js";
import { AiReasoningFilter } from "./ai-reasoning-filter.js";

export type AiTurnResult = "ok" | "erro" | "cancelado";

/** Ferramentas cuja primeira chamada define `schema_valid_first_try`. */
const SCHEMA_TOOLS = new Set([
  "preview_component",
  "create_or_update_dashboard",
]);

function toolNameOf(serialized: Serialized, runName?: string): string {
  const named = (serialized as { name?: unknown }).name;
  if (runName) return runName;
  if (typeof named === "string") return named;
  return serialized.id?.[serialized.id.length - 1] ?? "unknown";
}

/** A ferramenta devolve `{ ok: false, ... }` serializado quando recusa ou falha. */
function outputReportsFailure(output: unknown): boolean {
  const content =
    typeof output === "string"
      ? output
      : output && typeof output === "object" && "content" in output
        ? (output as { content: unknown }).content
        : undefined;
  if (typeof content !== "string") return false;
  try {
    const parsed: unknown = JSON.parse(content);
    return (
      !!parsed &&
      typeof parsed === "object" &&
      (parsed as { ok?: unknown }).ok === false
    );
  } catch {
    return false;
  }
}

/**
 * `chat-stream` aborta o agente (AbortError) logo depois de uma ferramenta devolver
 * `ok: true` com cartão de aprovação (query_preview, component_preview, formulário).
 * O LangChain reporta isso em `handleToolError`, mas a chamada foi bem-sucedida.
 */
function isStructuredStopAbort(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as Error).name === "AbortError"
  );
}

/** Texto da recusa (mensagem do Zod), cortado para não inflar o arquivo. */
function rejectionText(content: unknown): string | null {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part) =>
              part && typeof part === "object" && "text" in part
                ? String((part as { text: unknown }).text)
                : "",
            )
            .join("")
        : "";
  return text ? text.slice(0, 600) : null;
}

function sqlFromToolInput(input: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(input);
    const sql = (parsed as { sqlText?: unknown } | null)?.sqlText;
    return typeof sql === "string" ? sql : undefined;
  } catch {
    return undefined;
  }
}

interface TokenUsage {
  input: number;
  output: number;
  total: number;
  reasoning: number | null;
}

function usageOf(result: LLMResult): TokenUsage | null {
  const message = result.generations?.[0]?.[0] as
    | {
        message?: {
          usage_metadata?: {
            input_tokens?: number;
            output_tokens?: number;
            total_tokens?: number;
            output_token_details?: { reasoning?: number };
          };
        };
      }
    | undefined;
  const meta = message?.message?.usage_metadata;
  if (meta && typeof meta.total_tokens === "number")
    return {
      input: meta.input_tokens ?? 0,
      output: meta.output_tokens ?? 0,
      total: meta.total_tokens,
      reasoning:
        typeof meta.output_token_details?.reasoning === "number"
          ? meta.output_token_details.reasoning
          : null,
    };
  const legacy = result.llmOutput?.tokenUsage as
    | { promptTokens?: number; completionTokens?: number; totalTokens?: number }
    | undefined;
  if (legacy && typeof legacy.totalTokens === "number")
    return {
      input: legacy.promptTokens ?? 0,
      output: legacy.completionTokens ?? 0,
      total: legacy.totalTokens,
      reasoning: null,
    };
  return null;
}

/**
 * Coleta as medidas de um turno do assistente: span raiz `ai.turn`, um filho
 * `ai.llm` por chamada ao modelo e um filho `ai.tool.<nome>` por chamada de ferramenta.
 */
export class AiTurnTelemetry {
  private readonly root: TelemetrySpan;
  private readonly startMs: number;
  private readonly open = new Map<string, TelemetrySpan>();
  private readonly sqls: string[] = [];
  private toolCalls = 0;
  private testQueryFailures = 0;
  private llmCalls = 0;
  private firstTargetValid: boolean | undefined;
  private ttftVisibleMs: number | undefined;
  private ttftModelMs: number | undefined;
  private thinkingMs = 0;
  private thinkingChars = 0;
  private thinkingBlocks = 0;
  private readonly thinkingTexts: string[] = [];
  private responseText = "";
  private reasoning: AiReasoningFilter | undefined;
  private tokens: TokenUsage | null = null;
  private finished = false;
  private readonly executedCalls = new Set<string>();

  /** Handler a passar em `agent.stream(..., { callbacks })`. */
  readonly callbacks: BaseCallbackHandler[];

  constructor(
    telemetry: TelemetryPort,
    private readonly options: {
      turnId: string;
      threadId?: string;
      model: string;
      userMessage?: string;
      participant?: string;
      now: () => number;
      startMs?: number;
    },
  ) {
    this.startMs = options.startMs ?? options.now();
    this.root = telemetry.startSpan("ai.turn", {
      turnId: options.turnId,
      threadId: options.threadId ?? null,
      startedAt: new Date(this.startMs).toISOString(),
      model: options.model,
      participant: options.participant ?? null,
    });
    this.callbacks = telemetry.enabled ? [this.createHandler()] : [];
  }

  /** Texto bruto do modelo (com `<think>`), conforme chega no stream. */
  onModelText(delta: string) {
    if (this.ttftModelMs === undefined)
      this.ttftModelMs = this.options.now() - this.startMs;
    this.reasoning ??= new AiReasoningFilter({ clock: this.options.now });
    this.reasoning.push(delta);
  }

  /** Primeiro trecho visível (depois do filtro de raciocínio) enviado ao cliente. */
  onVisibleToken(delta = "") {
    this.ttftVisibleMs ??= this.options.now() - this.startMs;
    this.responseText += delta;
  }

  /**
   * Mensagens do stream do agente. Daqui saem: (1) a contagem de tokens, que vem no
   * último trecho de cada chamada ao modelo; (2) chamadas de ferramenta que não
   * chegaram a executar (recusadas pelo schema Zod ou pelo preflight), que não
   * disparam os callbacks de ferramenta.
   */
  onStreamMessage(chunk: unknown) {
    const message = chunk as
      | {
          type?: string;
          name?: string;
          status?: string;
          tool_call_id?: string;
          content?: unknown;
          usage_metadata?: {
            input_tokens?: number;
            output_tokens?: number;
            total_tokens?: number;
            output_token_details?: { reasoning?: number };
          };
        }
      | undefined;
    if (!message) return;
    const usage = message.usage_metadata;
    if (usage && typeof usage.total_tokens === "number")
      this.addTokens({
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        total: usage.total_tokens,
        reasoning:
          typeof usage.output_token_details?.reasoning === "number"
            ? usage.output_token_details.reasoning
            : null,
      });
    if (message.type !== "tool" || !message.name) return;
    const id = message.tool_call_id;
    if (id && this.executedCalls.has(id)) return;
    if (id) this.executedCalls.add(id);
    const schemaRejected = message.status === "error";
    const ok = !schemaRejected && !outputReportsFailure(message);
    const span = this.root.child(`ai.tool.${message.name}`, {
      toolName: message.name,
      toolCallId: id ?? null,
      ok,
      not_executed: true,
      rejected_by_schema: schemaRejected,
      ...(schemaRejected
        ? { rejection_message: rejectionText(message.content) }
        : {}),
    });
    span.end();
    this.toolCalls += 1;
    this.recordToolOutcome(message.name, ok, schemaRejected ? false : true);
  }

  finish(result: AiTurnResult) {
    if (this.finished) return;
    this.finished = true;
    this.closeReasoning();
    for (const span of this.open.values()) span.end();
    this.open.clear();
    this.root.setAttributes({
      L_total_ms: this.options.now() - this.startMs,
      TTFT_ms: this.ttftVisibleMs ?? null,
      TTFT_model_ms: this.ttftModelMs ?? null,
      T_thinking_ms: this.thinkingBlocks > 0 ? this.thinkingMs : 0,
      thinking_chars: this.thinkingChars,
      thinking_blocks: this.thinkingBlocks,
      user_message: this.options.userMessage ?? null,
      response_text: this.responseText,
      thinking_text: this.thinkingTexts.filter(Boolean).join("\n\n"),
      llm_calls_count: this.llmCalls,
      tool_calls_count: this.toolCalls,
      test_query_failures: this.testQueryFailures,
      tokens_input: this.tokens?.input ?? null,
      tokens_output: this.tokens?.output ?? null,
      tokens_total: this.tokens?.total ?? null,
      tokens_reasoning: this.tokens?.reasoning ?? null,
      schema_valid_first_try: this.firstTargetValid ?? null,
      generated_sql: this.sqls,
      result,
    });
    this.root.end(result === "erro" ? { error: "erro" } : undefined);
  }

  private closeReasoning() {
    const filter = this.reasoning;
    if (!filter) return;
    filter.finish();
    this.thinkingMs += filter.thinkingMs;
    this.thinkingChars += filter.thinkingChars;
    this.thinkingBlocks += filter.thinkingBlocks;
    this.thinkingTexts.push(filter.thinkingText);
    this.reasoning = undefined;
  }

  private addTokens(usage: TokenUsage) {
    const current = this.tokens;
    this.tokens = {
      input: (current?.input ?? 0) + usage.input,
      output: (current?.output ?? 0) + usage.output,
      total: (current?.total ?? 0) + usage.total,
      reasoning:
        usage.reasoning === null && (current?.reasoning ?? null) === null
          ? null
          : (current?.reasoning ?? 0) + (usage.reasoning ?? 0),
    };
  }

  private createHandler(): BaseCallbackHandler {
    const turn = this;
    class Handler extends BaseCallbackHandler {
      name = "ai-turn-telemetry";
      awaitHandlers = true;
      raiseError = false;

      override handleChatModelStart(
        _llm: Serialized,
        _messages: unknown,
        runId: string,
      ) {
        turn.closeReasoning();
        turn.llmCalls += 1;
        turn.open.set(
          runId,
          turn.root.child("ai.llm", {
            model: turn.options.model,
            callIndex: turn.llmCalls,
          }),
        );
        turn.reasoning = new AiReasoningFilter({ clock: turn.options.now });
      }

      override handleLLMEnd(output: LLMResult, runId: string) {
        const usage = usageOf(output);
        const span = turn.open.get(runId);
        turn.open.delete(runId);
        span?.setAttributes({
          tokens_input: usage?.input ?? null,
          tokens_output: usage?.output ?? null,
          tokens_total: usage?.total ?? null,
          tokens_reasoning: usage?.reasoning ?? null,
        });
        span?.end();
      }

      override handleLLMError(_error: unknown, runId: string) {
        const span = turn.open.get(runId);
        turn.open.delete(runId);
        span?.end({ error: "llm_error" });
      }

      override handleToolStart(
        tool: Serialized,
        input: string,
        runId: string,
        _parentRunId?: string,
        _tags?: string[],
        _metadata?: Record<string, unknown>,
        runName?: string,
        toolCallId?: string,
      ) {
        const toolName = toolNameOf(tool, runName);
        turn.toolCalls += 1;
        if (toolCallId) turn.executedCalls.add(toolCallId);
        if (toolName === "test_query") {
          const sql = sqlFromToolInput(input);
          if (sql) turn.sqls.push(sql);
        }
        const span = turn.root.child(`ai.tool.${toolName}`, {
          toolName,
          toolCallId: toolCallId ?? null,
        });
        turn.toolNames.set(span, toolName);
        turn.open.set(runId, span);
      }

      override handleToolEnd(output: unknown, runId: string) {
        const span = turn.open.get(runId);
        turn.open.delete(runId);
        const ok = !outputReportsFailure(output);
        const toolName = turn.toolNameOfSpan(span);
        turn.recordToolOutcome(toolName, ok, true);
        span?.setAttributes({ ok });
        span?.end();
      }

      override handleToolError(error: unknown, runId: string) {
        const span = turn.open.get(runId);
        turn.open.delete(runId);
        const toolName = turn.toolNameOfSpan(span);
        if (isStructuredStopAbort(error)) {
          // O resultado da ferramenta foi ok e o stream foi interrompido de propósito
          // para o administrador aprovar o cartão: não é falha da ferramenta.
          turn.recordToolOutcome(toolName, true, true);
          span?.setAttributes({ ok: true, paused_for_user: true });
          span?.end();
          return;
        }
        turn.recordToolOutcome(toolName, false, false);
        span?.setAttributes({ ok: false });
        span?.end({ error: "tool_error" });
      }
    }
    return new Handler();
  }

  private readonly toolNames = new WeakMap<TelemetrySpan, string>();

  private toolNameOfSpan(span: TelemetrySpan | undefined): string {
    return (span && this.toolNames.get(span)) ?? "";
  }

  private recordToolOutcome(
    toolName: string,
    ok: boolean,
    schemaValid: boolean = ok,
  ) {
    if (toolName === "test_query" && !ok) this.testQueryFailures += 1;
    if (SCHEMA_TOOLS.has(toolName)) this.firstTargetValid ??= schemaValid;
  }
}
