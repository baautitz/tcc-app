import { latestUserAskedToAddDashboardComponent } from "../ai-agent.js";
import type { AiToolProgressEvent } from "../ai-read-tools.js";
import type { AiChatMessages, AiChatRequest } from "./chat-schemas.js";

export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return [part.text];
      }
      return [];
    })
    .join("");
}

export function normalizedUserRequest(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function repeatsDashboardComponentRequest(
  messages: AiChatMessages,
  pageContext: AiChatRequest["pageContext"],
) {
  const userMessages = messages.filter((message) => message.role === "user");
  const latestRequest = userMessages.at(-1)?.content;
  if (!latestRequest) return false;
  const latestIsDashboardRequest = latestUserAskedToAddDashboardComponent(
    messages,
    pageContext,
  );
  const normalizedLatest = normalizedUserRequest(latestRequest);
  const repeatsRecentRequest =
    latestIsDashboardRequest &&
    userMessages
      .slice(0, -1)
      .some(
        (message) =>
          normalizedUserRequest(message.content) === normalizedLatest,
      );
  if (repeatsRecentRequest) return true;

  const isProposalStatusFollowUp =
    /^[?!.…\s]+$/.test(latestRequest) ||
    (/\b(aplicar|visualizar|proposta|previ\w*|cartao|botao)\b/.test(
      normalizedLatest,
    ) &&
      /\b(nao|tem|cade|onde|aparece|apareceu|sumiu)\b/.test(normalizedLatest));
  if (!isProposalStatusFollowUp) return false;
  return userMessages
    .slice(-5, -1)
    .some((message) =>
      latestUserAskedToAddDashboardComponent([message], pageContext),
    );
}

export function queryUpdateRequest(text: string): {
  requested: boolean;
  queryName?: string;
} {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const requestsChange =
    /\b(ajust\w*|corrig\w*|alter\w*|modific\w*|atualiz\w*)\b/.test(normalized);
  const referencesQuery = /\b(query|consulta|sql)\b/.test(normalized);
  const quotedName = text
    .match(
      /\b(?:query|consulta|sql)\s+(?:(?:de|chamada|chamado)\s+)?[“"']([^”"']{2,160})[”"']/i,
    )?.[1]
    ?.trim();
  return {
    requested: requestsChange && referencesQuery,
    ...(quotedName ? { queryName: quotedName } : {}),
  };
}

export function isMatchingQueryUpdatePreview(
  event: AiToolProgressEvent | undefined,
  expectedName?: string,
): boolean {
  if (event?.type !== "query_preview" || event.intent.mode !== "update")
    return false;
  if (!expectedName) return true;
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  return normalize(event.intent.queryName) === normalize(expectedName);
}
