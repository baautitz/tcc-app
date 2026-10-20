import type { ChatEvent } from "@/modules/ai/model/chat-sse";
import {
  insertAfter,
  insertBefore,
  newId,
  normalizeQueryPreviewName,
  type ChatItem,
  type ChatMessage,
  type ToolMessage,
} from "@/modules/ai/model/chat-items";

const patchAssistant = (
  items: ChatItem[],
  assistantId: string,
  update: (message: ChatMessage) => ChatMessage,
): ChatItem[] =>
  items.map((item) =>
    item.kind === "message" && item.id === assistantId ? update(item) : item,
  );

/** Pure items transition for a stream event (side effects live in useChatSend). */
export function applyChatEvent(
  items: ChatItem[],
  event: ChatEvent,
  assistantId: string,
): ChatItem[] {
  switch (event.type) {
    case "token":
      return patchAssistant(items, assistantId, (message) => ({
        ...message,
        content: message.content + event.delta,
        status: "streaming",
      }));
    case "tool_start":
      return insertBefore(items, assistantId, {
        id: event.toolCallId,
        kind: "tool",
        toolName: event.toolName,
        status: "running",
      });
    case "tool_result": {
      const status = event.ok ? "success" : "failed";
      if (!items.some((i) => i.kind === "tool" && i.id === event.toolCallId)) {
        const tool: ToolMessage = {
          id: event.toolCallId,
          kind: "tool",
          toolName: event.toolName,
          status,
        };
        const assistantIndex = items.findIndex(
          (item) => item.kind === "message" && item.id === assistantId,
        );
        const at = assistantIndex < 0 ? items.length : assistantIndex;
        return [...items.slice(0, at), tool, ...items.slice(at)];
      }
      return items.map((item) =>
        item.kind === "tool" && item.id === event.toolCallId
          ? { ...item, status }
          : item,
      );
    }
    case "query_preview": {
      const marked = items.map((item) => {
        if (item.kind !== "query_preview" || item.savedQueryId) return item;
        const sameTarget =
          item.intent.mode === event.intent.mode &&
          (event.intent.mode === "update"
            ? Boolean(event.intent.queryId) &&
              item.intent.queryId === event.intent.queryId
            : item.dataSource.id === event.dataSource.id &&
              normalizeQueryPreviewName(item.intent.queryName) ===
                normalizeQueryPreviewName(event.intent.queryName));
        if (!sameTarget) return item;
        const draftChanged =
          item.dataSource.id !== event.dataSource.id ||
          item.sqlText !== event.sqlText ||
          JSON.stringify(item.parameters) !==
            JSON.stringify(event.parameters) ||
          JSON.stringify(item.testValues) !==
            JSON.stringify(event.testValues) ||
          item.intent.mode !== event.intent.mode ||
          item.intent.queryId !== event.intent.queryId;
        return draftChanged ? { ...item, stale: true } : item;
      });
      return insertAfter(marked, assistantId, {
        id: event.testRunId,
        kind: "query_preview",
        testRunId: event.testRunId,
        dataSource: event.dataSource,
        purpose: event.purpose,
        intent: event.intent,
        sqlText: event.sqlText,
        parameters: event.parameters,
        testValues: event.testValues,
        rows: event.rows,
        rowCount: event.rowCount,
        rowLimit: event.rowLimit,
        byteLimit: event.byteLimit,
        bytes: event.bytes,
        truncated: event.truncated,
        truncationReason: event.truncationReason,
      });
    }
    case "proposal":
      return insertAfter(items, assistantId, {
        id: event.proposalId,
        kind: "proposal",
        title: event.title,
        summary: event.summary,
      });
    case "context_proposal":
      return insertAfter(items, assistantId, {
        id: event.proposal.id,
        kind: "context_proposal",
        proposal: event.proposal,
      });
    case "questionnaire":
      return insertAfter(items, assistantId, {
        id: event.toolCallId,
        toolCallId: event.toolCallId,
        kind: "questionnaire",
        questionnaire: event.questionnaire,
      });
    case "dashboard_preview": {
      const marked = items.map((item) =>
        item.kind === "dashboard_preview" &&
        !item.saved &&
        item.dashboardId === event.dashboardId
          ? { ...item, stale: true }
          : item,
      );
      return insertAfter(marked, assistantId, {
        ...event,
        id: event.proposalId,
        kind: "dashboard_preview",
      });
    }
    case "error":
      return insertBefore(
        patchAssistant(items, assistantId, (m) => ({ ...m, status: "error" })),
        assistantId,
        {
          id: newId(),
          kind: "error",
          assistantId,
          retryable: event.retryable,
          message: event.message,
        },
      );
    case "done":
      return patchAssistant(items, assistantId, (m) => ({
        ...m,
        status: "complete",
      }));
    default:
      return items;
  }
}
