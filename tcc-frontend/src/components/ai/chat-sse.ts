import type {
  AiContextProposal,
  DashboardDefinition,
  DashboardDocument,
  QueryPreview,
} from "../../types";

type DashboardPreviewQuery = {
  rows: Record<string, unknown>[];
  rowLimit: number;
  byteLimit: number;
  bytes: number;
  truncated: boolean;
  truncationReason: "row_limit" | "byte_limit" | null;
  error?: string;
};

export type AiQuestionnaireChoice = {
  value: string;
  label: string;
  description?: string;
};

export type AiQuestionnaireQuestion = {
  name: string;
  prompt: string;
  description?: string;
  required: boolean;
  multiple: boolean;
  choices: AiQuestionnaireChoice[];
  allowOther: boolean;
  otherLabel: string;
  otherPlaceholder: string;
};

export type AiQuestionnaire = {
  title: string;
  questions: AiQuestionnaireQuestion[];
};

type DashboardPreviewItem = {
  id: string;
  kind: "dashboard_preview";
  toolCallId: string;
  proposalId: string;
  previewComponentIds: string[];
  expiresAt: string;
  canCommit: boolean;
  issues: string[];
  mode: "create" | "update";
  dashboardId: string;
  expectedDashboardFingerprint: string | null;
  document: DashboardDocument;
  definition: DashboardDefinition;
  changeSummary: string[];
  requiresTruncationAcknowledgement: boolean;
  queries: Record<string, DashboardPreviewQuery>;
  saved?: boolean;
  stale?: boolean;
  saving?: boolean;
};

export type ChatEvent =
  | { version: 1; type: "start"; requestId: string; messageId: string }
  | { version: 1; type: "token"; messageId: string; delta: string }
  | { version: 1; type: "tool_start"; toolCallId: string; toolName: string }
  | { version: 1; type: "tool_result"; toolCallId: string; toolName: string; ok: boolean }
  | ({ version: 1; type: "query_preview"; toolCallId: string } & QueryPreview)
  | ({ version: 1; type: "dashboard_preview" } & Omit<DashboardPreviewItem, "id" | "kind" | "saved" | "stale">)
  | { version: 1; type: "questionnaire"; toolCallId: string; questionnaire: AiQuestionnaire }
  | { version: 1; type: "context_proposal"; toolCallId: string; proposal: AiContextProposal }
  | { version: 1; type: "proposal"; proposalId: string; kind: string; title: string; summary: string }
  | { version: 1; type: "error"; code: string; message: string; retryable: boolean }
  | { version: 1; type: "done"; messageId: string; finishReason: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function decodeEvent(eventName: string, data: string): ChatEvent | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(data) as unknown;
  } catch {
    throw new Error("A resposta de streaming da IA está malformada.");
  }
  if (!isRecord(payload)) {
    throw new Error("A resposta de streaming da IA está malformada.");
  }
  if (payload.version !== 1) {
    throw new Error("A versão do protocolo de streaming da IA não é compatível.");
  }
  const type = payload.type ?? eventName;
  if (typeof type !== "string" || (eventName !== "message" && type !== eventName)) {
    throw new Error("O evento de streaming da IA não corresponde ao protocolo.");
  }
  const normalizedPayload = { ...payload, type };

  switch (type) {
    case "start":
      if (typeof payload.requestId === "string" && typeof payload.messageId === "string") return normalizedPayload as ChatEvent;
      throw new Error("O evento de início da IA está malformado.");
    case "token":
      if (typeof payload.messageId === "string" && typeof payload.delta === "string") return normalizedPayload as ChatEvent;
      throw new Error("O evento de texto da IA está malformado.");
    case "tool_start":
      if (typeof payload.toolCallId === "string" && typeof payload.toolName === "string") return normalizedPayload as ChatEvent;
      throw new Error("O evento de ferramenta da IA está malformado.");
    case "tool_result":
      if (typeof payload.toolCallId === "string" && typeof payload.toolName === "string" && typeof payload.ok === "boolean") return normalizedPayload as ChatEvent;
      throw new Error("O resultado da ferramenta da IA está malformado.");
    case "query_preview": {
      const dataSource = payload.dataSource;
      const intent = payload.intent;
      const parameters = payload.parameters;
      const rows = payload.rows;
      const testValues = payload.testValues;
      const validParameters = Array.isArray(parameters) && parameters.every((parameter) =>
        isRecord(parameter) &&
        typeof parameter.name === "string" &&
        typeof parameter.label === "string" &&
        ["text", "number", "date", "boolean", "multi_select"].includes(String(parameter.type)) &&
        typeof parameter.required === "boolean",
      );
      const validValues = isRecord(testValues) && Object.values(testValues).every((value) =>
        typeof value === "string" || (Array.isArray(value) && value.every((entry) => typeof entry === "string")),
      );
      if (
        typeof payload.toolCallId === "string" &&
        typeof payload.testRunId === "string" &&
        isRecord(dataSource) && typeof dataSource.id === "string" && typeof dataSource.name === "string" &&
        isRecord(intent) && ["create", "update"].includes(String(intent.mode)) && typeof intent.queryName === "string" &&
        (intent.queryId === undefined || typeof intent.queryId === "string") &&
        (intent.queryUpdatedAt === undefined || typeof intent.queryUpdatedAt === "string") &&
        (intent.mode !== "update" || (typeof intent.queryId === "string" && typeof intent.queryUpdatedAt === "string")) &&
        typeof payload.sqlText === "string" && validParameters && validValues &&
        Array.isArray(rows) && rows.every(isRecord) &&
        Number.isSafeInteger(payload.rowCount) && payload.rowCount === rows.length &&
        Number.isSafeInteger(payload.rowLimit) && (payload.rowLimit as number) > 0 && rows.length <= (payload.rowLimit as number) &&
        Number.isSafeInteger(payload.byteLimit) && (payload.byteLimit as number) > 0 &&
        Number.isSafeInteger(payload.bytes) && (payload.bytes as number) >= 0 && (payload.bytes as number) <= (payload.byteLimit as number) &&
        typeof payload.truncated === "boolean" &&
        (payload.truncationReason === null || ["row_limit", "byte_limit"].includes(String(payload.truncationReason)))
      ) return normalizedPayload as ChatEvent;
      throw new Error("A prévia da query está malformada.");
    }
    case "proposal":
      if (
        typeof payload.proposalId === "string" &&
        typeof payload.kind === "string" &&
        typeof payload.title === "string" &&
        typeof payload.summary === "string"
      ) return normalizedPayload as ChatEvent;
      throw new Error("A proposta da IA está malformada.");
    case "context_proposal": {
      const proposal = payload.proposal;
      if (
        typeof payload.toolCallId === "string" &&
        isRecord(proposal) &&
        typeof proposal.id === "string" &&
        typeof proposal.actorId === "string" &&
        ["source", "table"].includes(String(proposal.targetType)) &&
        typeof proposal.dataSourceId === "string" &&
        typeof proposal.sourceName === "string" &&
        ((proposal.targetType === "source" && proposal.tableId === null && proposal.schemaName === null && proposal.tableName === null) ||
          (proposal.targetType === "table" && typeof proposal.tableId === "string" && typeof proposal.schemaName === "string" && typeof proposal.tableName === "string")) &&
        Number.isSafeInteger(proposal.baseContextVersion) && (proposal.baseContextVersion as number) > 0 &&
        typeof proposal.currentContext === "string" &&
        typeof proposal.proposedContext === "string" &&
        typeof proposal.reason === "string" &&
        proposal.status === "pending" &&
        typeof proposal.expiresAt === "string" &&
        typeof proposal.createdAt === "string" &&
        (proposal.resolvedAt === null || typeof proposal.resolvedAt === "string")
      ) return normalizedPayload as ChatEvent;
      throw new Error("A proposta de contexto da IA está malformada.");
    }
    case "dashboard_preview": {
      const document = payload.document;
      const definition = payload.definition;
      const queries = payload.queries;
      const previewComponentIds = payload.previewComponentIds;
      const definitionComponentIds = isRecord(definition) && Array.isArray(definition.components)
        ? definition.components.flatMap((component) =>
            isRecord(component) && typeof component.id === "string" ? [component.id] : [],
          )
        : [];
      const validQueries = isRecord(queries) && Object.values(queries).every((query) =>
        isRecord(query) &&
        Array.isArray(query.rows) && query.rows.every(isRecord) &&
        Number.isSafeInteger(query.rowLimit) && (query.rowLimit as number) > 0 && query.rows.length <= (query.rowLimit as number) &&
        Number.isSafeInteger(query.byteLimit) && (query.byteLimit as number) > 0 &&
        Number.isSafeInteger(query.bytes) && (query.bytes as number) >= 0 && (query.bytes as number) <= (query.byteLimit as number) &&
        typeof query.truncated === "boolean" &&
        (query.truncationReason === null || ["row_limit", "byte_limit"].includes(String(query.truncationReason))) &&
        (query.error === undefined || typeof query.error === "string") &&
        (query.previewPending === undefined || typeof query.previewPending === "string"),
      );
      if (
        typeof payload.toolCallId === "string" &&
        typeof payload.proposalId === "string" &&
        typeof payload.expiresAt === "string" &&
        typeof payload.canCommit === "boolean" && Array.isArray(payload.issues) && payload.issues.every((issue) => typeof issue === "string") &&
        ["create", "update"].includes(String(payload.mode)) &&
        typeof payload.dashboardId === "string" &&
        (payload.expectedDashboardFingerprint === null || typeof payload.expectedDashboardFingerprint === "string") &&
        isRecord(document) && typeof document.id === "string" && typeof document.name === "string" &&
        isRecord(definition) && Array.isArray(definition.components) &&
        Array.isArray(previewComponentIds) && previewComponentIds.length > 0 &&
        previewComponentIds.every((id) => typeof id === "string" && definitionComponentIds.includes(id)) &&
        new Set(previewComponentIds).size === previewComponentIds.length &&
        validQueries
      ) return normalizedPayload as ChatEvent;
      throw new Error("A prévia do dashboard está malformada.");
    }
    case "questionnaire": {
      const questionnaire = payload.questionnaire;
      const validQuestions = isRecord(questionnaire) &&
        typeof questionnaire.title === "string" &&
        Array.isArray(questionnaire.questions) &&
        questionnaire.questions.length > 0 &&
        questionnaire.questions.length <= 5 &&
        questionnaire.questions.every((question) =>
          isRecord(question) &&
          typeof question.name === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(question.name) &&
          typeof question.prompt === "string" &&
          (question.description === undefined || typeof question.description === "string") &&
          typeof question.required === "boolean" &&
          typeof question.multiple === "boolean" &&
          typeof question.allowOther === "boolean" &&
          typeof question.otherLabel === "string" &&
          typeof question.otherPlaceholder === "string" &&
          Array.isArray(question.choices) &&
          question.choices.length <= 8 &&
          question.choices.every((choice) =>
            isRecord(choice) &&
            typeof choice.value === "string" &&
            typeof choice.label === "string" &&
            (choice.description === undefined || typeof choice.description === "string"),
          ) &&
          (question.choices.length > 0 || question.allowOther),
        );
      if (typeof payload.toolCallId === "string" && validQuestions) {
        return normalizedPayload as ChatEvent;
      }
      throw new Error("O formulário de esclarecimento da IA está malformado.");
    }
    case "error":
      if (typeof payload.code === "string" && typeof payload.message === "string" && typeof payload.retryable === "boolean") return normalizedPayload as ChatEvent;
      throw new Error("O evento de erro da IA está malformado.");
    case "done":
      if (typeof payload.messageId === "string" && (typeof payload.finishReason === "string" || payload.finishReason === null)) return normalizedPayload as ChatEvent;
      throw new Error("O evento de conclusão da IA está malformado.");
    default:
      throw new Error("A IA enviou um evento de streaming desconhecido.");
  }
}

export class SseV1Parser {
  private buffer = "";
  private data: string[] = [];
  private eventName = "message";
  private startedMessageId: string | undefined;
  private terminal = false;

  push(chunk: string, final = false): ChatEvent[] {
    this.buffer += chunk;
    const events: ChatEvent[] = [];
    let lineStart = 0;

    for (let index = 0; index < this.buffer.length; index += 1) {
      const character = this.buffer[index];
      if (character !== "\n" && character !== "\r") continue;
      if (character === "\r" && index === this.buffer.length - 1 && !final) break;

      this.consumeLine(this.buffer.slice(lineStart, index), events);
      if (character === "\r" && this.buffer[index + 1] === "\n") index += 1;
      lineStart = index + 1;
    }

    this.buffer = this.buffer.slice(lineStart);
    if (final) {
      if (this.buffer.length) this.consumeLine(this.buffer, events);
      this.buffer = "";
      this.consumeLine("", events);
      if (this.startedMessageId === undefined) throw new Error("O stream da IA terminou sem evento de início.");
      if (!this.terminal) throw new Error("O stream da IA terminou sem evento terminal.");
    }
    return events;
  }

  private consumeLine(line: string, events: ChatEvent[]) {
    if (line === "") {
      if (this.data.length) {
        const event = decodeEvent(this.eventName, this.data.join("\n"));
        if (event) {
          this.validateOrder(event);
          events.push(event);
        }
      }
      this.data = [];
      this.eventName = "message";
      return;
    }
    if (line.startsWith(":")) return;

    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.eventName = value;
    if (field === "data") this.data.push(value);
  }

  private validateOrder(event: ChatEvent) {
    if (this.terminal) throw new Error("A IA enviou eventos após a conclusão do streaming.");
    if (event.type === "start") {
      if (this.startedMessageId !== undefined) throw new Error("O evento de início da IA apareceu mais de uma vez.");
      this.startedMessageId = event.messageId;
      return;
    }
    if (this.startedMessageId === undefined) throw new Error("O streaming da IA começou antes do evento de início.");
    if ((event.type === "token" || event.type === "done") && event.messageId !== this.startedMessageId) {
      throw new Error("O ID da mensagem do evento de streaming da IA não corresponde ao início.");
    }
    if (event.type === "done" || event.type === "error") this.terminal = true;
  }
}

export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseV1Parser();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) onEvent(event);
    }
    const finalChunk = decoder.decode();
    for (const event of parser.push(finalChunk, true)) onEvent(event);
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // The response may already have closed or its request may be aborted.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}
