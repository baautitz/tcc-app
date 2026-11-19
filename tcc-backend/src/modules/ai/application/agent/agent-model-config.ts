import { ChatOpenAI } from "@langchain/openai";
import { DomainError } from "../../../../shared/lib/domain-error.js";
import {
  getEnvironment,
  type Environment,
} from "../../../../shared/config/config.js";

type AiEnvironment = Pick<
  Environment,
  | "AI_BASE_URL"
  | "AI_API_KEY"
  | "AI_MODEL"
  | "AI_REQUEST_TIMEOUT_MS"
  | "AI_REASONING_EFFORT"
  | "AI_USE_RESPONSES_API"
>;

export const AI_REASONING_EFFORTS = ["minimal", "low", "medium", "high"] as const;
export type AiReasoningEffort = (typeof AI_REASONING_EFFORTS)[number];

export const DEFAULT_AI_REQUEST_TIMEOUT_MS = 180_000;
export const MIN_AI_REQUEST_TIMEOUT_MS = 1_000;
export const MAX_AI_REQUEST_TIMEOUT_MS = 300_000;
export const AI_MAX_OUTPUT_TOKENS = 12_288;

export type AiConfigurationIssue =
  | { enabled: false; code: "AI_NOT_CONFIGURED"; missing: string[] }
  | { enabled: false; code: "AI_CONFIGURATION_INVALID"; message: string };

export type ResolvedAiConfiguration =
  | {
      enabled: true;
      baseURL: string;
      apiKey: string;
      model: string;
      requestTimeoutMs: number;
      reasoningEffort?: AiReasoningEffort;
      useResponsesApi?: boolean;
    }
  | AiConfigurationIssue;

export class AiUnavailableError extends DomainError {
  constructor(public readonly issue: AiConfigurationIssue) {
    super(
      issue.code === "AI_NOT_CONFIGURED"
        ? "O serviço de IA não está configurado."
        : "A configuração do serviço de IA é inválida.",
      issue.code,
      "bad_request",
    );
    this.name = "AiUnavailableError";
  }
}

function clean(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

export class AiConfigService {
  resolve(values: AiEnvironment = getEnvironment()): ResolvedAiConfiguration {
    const baseURL = clean(values.AI_BASE_URL);
    const apiKey = clean(values.AI_API_KEY);
    const model = clean(values.AI_MODEL);
    const configuredTimeout = clean(values.AI_REQUEST_TIMEOUT_MS);
    const missing = [
      ["AI_BASE_URL", baseURL],
      ["AI_API_KEY", apiKey],
      ["AI_MODEL", model],
    ]
      .filter((entry): entry is [string, undefined] => entry[1] === undefined)
      .map(([key]) => key);

    if (missing.length > 0) {
      return { enabled: false, code: "AI_NOT_CONFIGURED", missing };
    }

    try {
      const parsedBaseURL = new URL(baseURL!);
      if (
        parsedBaseURL.protocol !== "http:" &&
        parsedBaseURL.protocol !== "https:"
      ) {
        throw new Error("unsupported protocol");
      }
    } catch {
      return {
        enabled: false,
        code: "AI_CONFIGURATION_INVALID",
        message: "AI_BASE_URL deve ser uma URL HTTP ou HTTPS válida.",
      };
    }

    let requestTimeoutMs = DEFAULT_AI_REQUEST_TIMEOUT_MS;
    if (configuredTimeout !== undefined) {
      const parsedTimeout = Number(configuredTimeout);
      if (
        !Number.isSafeInteger(parsedTimeout) ||
        parsedTimeout < MIN_AI_REQUEST_TIMEOUT_MS ||
        parsedTimeout > MAX_AI_REQUEST_TIMEOUT_MS
      ) {
        return {
          enabled: false,
          code: "AI_CONFIGURATION_INVALID",
          message: `AI_REQUEST_TIMEOUT_MS deve ser um inteiro entre ${MIN_AI_REQUEST_TIMEOUT_MS} e ${MAX_AI_REQUEST_TIMEOUT_MS}.`,
        };
      }
      requestTimeoutMs = parsedTimeout;
    }

    const configuredEffort = clean(values.AI_REASONING_EFFORT);
    if (
      configuredEffort !== undefined &&
      !(AI_REASONING_EFFORTS as readonly string[]).includes(configuredEffort)
    ) {
      return {
        enabled: false,
        code: "AI_CONFIGURATION_INVALID",
        message: `AI_REASONING_EFFORT deve ser um destes valores: ${AI_REASONING_EFFORTS.join(", ")}.`,
      };
    }

    return {
      enabled: true,
      baseURL: baseURL!,
      apiKey: apiKey!,
      model: model!,
      requestTimeoutMs,
      ...(configuredEffort
        ? { reasoningEffort: configuredEffort as AiReasoningEffort }
        : {}),
      ...(clean(values.AI_USE_RESPONSES_API)?.toLowerCase() === "true"
        ? { useResponsesApi: true }
        : {}),
    };
  }

  availability(
    values: AiEnvironment = getEnvironment(),
  ): { enabled: true; model: string } | AiConfigurationIssue {
    const configuration = this.resolve(values);
    if (!configuration.enabled) return configuration;
    return { enabled: true, model: configuration.model };
  }

  createModel(configuration = this.resolve()): ChatOpenAI {
    if (!configuration.enabled) throw new AiUnavailableError(configuration);

    const aiHost = new URL(configuration.baseURL).hostname.toLowerCase();
    const isMiniMax =
      aiHost === "minimax.io" ||
      aiHost.endsWith(".minimax.io") ||
      /minimax/i.test(configuration.model);
    // A API da OpenAI também devolve a contagem de tokens no fluxo (stream_options).
    const isOpenAI = aiHost === "api.openai.com";
    const isMiniMaxM3 =
      isMiniMax && /minimax[-_. ]?m3/i.test(configuration.model);

    return new ChatOpenAI({
      model: configuration.model,
      apiKey: configuration.apiKey,
      maxTokens: AI_MAX_OUTPUT_TOKENS,
      ...(isMiniMax
        ? {
            // MiniMax's OpenAI-compatible API prefers max_completion_tokens.
            // Override ChatOpenAI's legacy max_tokens field while retaining the
            // public maxTokens setting for callers and diagnostics.
            modelKwargs: {
              max_tokens: undefined,
              max_completion_tokens: AI_MAX_OUTPUT_TOKENS,
              ...(isMiniMaxM3 ? { reasoning_split: false } : {}),
            },
          }
        : {}),
      ...(configuration.reasoningEffort
        ? { reasoning: { effort: configuration.reasoningEffort } }
        : {}),
      // Alguns modelos só aceitam ferramentas com raciocínio pela Responses API.
      ...(configuration.useResponsesApi ? { useResponsesApi: true } : {}),
      configuration: { baseURL: configuration.baseURL },
      // Some OpenAI-compatible providers reject stream_options. A MiniMax aceita e
      // devolve a contagem de tokens (inclusive de raciocínio), usada na telemetria.
      streamUsage: isMiniMax || isOpenAI,
    });
  }
}

export const aiConfigService = new AiConfigService();
