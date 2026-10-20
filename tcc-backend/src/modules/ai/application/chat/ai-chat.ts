import type { Context } from "hono";
import type { StructuredToolInterface } from "@langchain/core/tools";
import {
  getEnvironment,
  type Environment,
} from "../../../../shared/config/config.js";
import {
  aiAgentFactory,
  aiConfigService,
  type AiAgentContext,
  type AiChatAgent,
  type ResolvedAiConfiguration,
} from "../agent/ai-agent.js";
import type { AuthenticatedUser } from "../../../identity/domain/auth-user.js";
import type { AiToolProgressEvent } from "../tools/ai-read-tools.js";
import { buildSystemPrompt } from "./chat-prompt.js";
import { chatRequestSchema, type AiChatRequest } from "./chat-schemas.js";
import {
  readBoundedJson,
  runChatStream,
  type AiChatHandlerContext,
  type ChatStreamHooks,
} from "./chat-stream.js";

export type { AiChatRequest, AiChatMessages } from "./chat-schemas.js";
export type { AiSseEvent } from "./chat-stream.js";

type AiAgentFactoryFn = (options: {
  systemPrompt: string;
  configuration: Extract<ResolvedAiConfiguration, { enabled: true }>;
  tools: StructuredToolInterface[];
  context: AiAgentContext;
}) => AiChatAgent;

type AiToolsFactory = (options: {
  currentUser: AuthenticatedUser;
  pageContext?: AiChatRequest["pageContext"];
  onToolEvent: (event: AiToolProgressEvent) => void | Promise<void>;
}) => StructuredToolInterface[];

function errorFromBody(context: AiChatHandlerContext, message: string) {
  return context.json({ error: message, code: "AI_INVALID_REQUEST" }, 400);
}

export interface AiChatServiceDependencies {
  createAgent?: AiAgentFactoryFn;
  createTools?: AiToolsFactory;
  getConfiguration?: () => ResolvedAiConfiguration;
  env?: Environment;
  now?: () => number;
}

type ChatContext = Context<{ Variables: { currentUser: AuthenticatedUser } }>;

export class AiChatService {
  private readonly createAgent: AiAgentFactoryFn;
  private readonly createTools: AiToolsFactory;
  private readonly getConfiguration: () => ResolvedAiConfiguration;
  private readonly now: () => number;

  constructor(dependencies: AiChatServiceDependencies = {}) {
    this.createAgent =
      dependencies.createAgent ?? ((options) => aiAgentFactory.create(options));
    this.createTools = dependencies.createTools ?? (() => []);
    this.getConfiguration =
      dependencies.getConfiguration ??
      (() => aiConfigService.resolve(dependencies.env ?? getEnvironment()));
    this.now = dependencies.now ?? Date.now;
  }

  async handle(context: ChatContext) {
    const { createAgent, createTools, getConfiguration, now } = this;

    if (!context.get("currentUser").isAdmin) {
      return context.json({ error: "Acesso restrito ao administrador." }, 403);
    }

    let parsedBody: AiChatRequest;
    try {
      const boundedBody = await readBoundedJson(context.req.raw);
      if (!boundedBody.ok) {
        if (boundedBody.tooLarge) {
          return context.json(
            {
              error: "A requisição excede o tamanho permitido.",
              code: "AI_REQUEST_TOO_LARGE",
            },
            413,
          );
        }
        return errorFromBody(
          context,
          "O corpo da requisição deve ser JSON válido.",
        );
      }
      const result = chatRequestSchema.safeParse(boundedBody.value);
      if (!result.success)
        return errorFromBody(
          context,
          "A conversa enviada é inválida ou excede os limites permitidos.",
        );
      parsedBody = result.data;
    } catch {
      return errorFromBody(
        context,
        "O corpo da requisição deve ser JSON válido.",
      );
    }

    const configuration = getConfiguration();
    if (!configuration.enabled) {
      if (configuration.code === "AI_NOT_CONFIGURED") {
        return context.json(
          {
            error: "O serviço de IA não está configurado.",
            code: configuration.code,
            missing: configuration.missing,
          },
          503,
        );
      }
      return context.json(
        {
          error: configuration.message,
          code: configuration.code,
        },
        503,
      );
    }

    const requestId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const currentUser = context.get("currentUser");
    const hooks: ChatStreamHooks = {
      enqueueToolEvent: () => undefined,
      resetAiResponseBuffer: () => undefined,
    };
    let agent: AiChatAgent;
    try {
      const tools = createTools({
        currentUser,
        pageContext: parsedBody.pageContext,
        onToolEvent: (event) => hooks.enqueueToolEvent(event),
      });
      agent = createAgent({
        systemPrompt: buildSystemPrompt(
          parsedBody.pageContext,
          parsedBody.continuation,
          parsedBody.savedQueries,
          parsedBody.pendingQueryPreviews,
        ),
        configuration,
        tools,
        context: {
          currentUserId: currentUser.id,
          isAdmin: currentUser.isAdmin,
          pathname: parsedBody.pageContext?.pathname,
          dashboardId: parsedBody.pageContext?.dashboardId,
          threadId: parsedBody.threadId,
          pendingDashboardContinuation:
            parsedBody.continuation?.type === "query_saved",
          clearPendingResponse: () => hooks.resetAiResponseBuffer(),
        },
      });
    } catch {
      console.error("[AI chat] agent initialization failed");
      return context.json(
        {
          error: "Não foi possível inicializar o serviço de IA.",
          code: "AI_INITIALIZATION_FAILED",
        },
        503,
      );
    }

    return runChatStream({
      context,
      parsedBody,
      configuration,
      agent,
      now,
      requestId,
      messageId,
      hooks,
    });
  }
}
