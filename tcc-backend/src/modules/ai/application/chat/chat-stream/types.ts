import type { Context } from "hono";
import type { AuthenticatedUser } from "../../../../identity/domain/auth-user.js";
import type { AiToolProgressEvent } from "../../tools/ai-read-tools.js";
import type { AiContextProposal } from "../../../domain/ai-context-proposals.js";

export type AiChatProgressPhase =
  "waiting_for_model" | "running_tool" | "preparing_response";

export type AiSseEvent =
  | { version: 1; type: "start"; requestId: string; messageId: string }
  | {
      version: 1;
      type: "progress";
      requestId: string;
      phase: AiChatProgressPhase;
      elapsedMs: number;
      toolName?: string;
    }
  | { version: 1; type: "token"; messageId: string; delta: string }
  | { version: 1; type: "tool_start"; toolCallId: string; toolName: string }
  | {
      version: 1;
      type: "tool_result";
      toolCallId: string;
      toolName: string;
      ok: boolean;
    }
  | ({ version: 1 } & Extract<AiToolProgressEvent, { type: "query_preview" }>)
  | ({ version: 1 } & Extract<
      AiToolProgressEvent,
      { type: "dashboard_preview" }
    >)
  | ({ version: 1 } & Extract<
      AiToolProgressEvent,
      { type: "component_preview" }
    >)
  | ({ version: 1 } & Extract<
      AiToolProgressEvent,
      { type: "dashboard_applied" }
    >)
  | ({ version: 1 } & Extract<AiToolProgressEvent, { type: "questionnaire" }>)
  | {
      version: 1;
      type: "context_proposal";
      toolCallId: string;
      proposal: AiContextProposal;
    }
  | {
      version: 1;
      type: "proposal";
      proposalId: string;
      kind: string;
      title: string;
      summary: string;
    }
  | {
      version: 1;
      type: "error";
      code: string;
      message: string;
      retryable: boolean;
    }
  | {
      version: 1;
      type: "done";
      messageId: string;
      finishReason: string | null;
    };

export type AiChatHandlerContext = Context<{
  Variables: { currentUser: AuthenticatedUser };
}>;

export interface ChatStreamHooks {
  enqueueToolEvent: (event: AiToolProgressEvent) => void | Promise<void>;
  resetAiResponseBuffer: () => void;
}
