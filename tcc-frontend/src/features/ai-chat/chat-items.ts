import type { QueryPreview, AiContextProposal, DashboardDefinition, DashboardDocument } from "@/types";
import type { QuestionnaireChatItem } from "./QuestionnaireCard";

export type ChatMessage = {
  id: string;
  kind: "message";
  role: "user" | "assistant";
  content: string;
  status: "complete" | "streaming" | "stopped" | "error";
  actionCard?: ChatActionCardRef;
};

export type ChatActionCardKind =
  | "proposal"
  | "context_proposal"
  | "query_preview"
  | "dashboard_preview"
  | "questionnaire";
export type ChatActionCardRef = { id: string; kind: ChatActionCardKind };

export type ToolMessage = {
  id: string;
  kind: "tool";
  toolName: string;
  status: "running" | "success" | "failed";
};

export type ProposalMessage = {
  id: string;
  kind: "proposal";
  title: string;
  summary: string;
  ownerMessageId?: string;
};
export type ContextProposalMessage = {
  id: string;
  kind: "context_proposal";
  proposal: AiContextProposal;
  ownerMessageId?: string;
};

export type ErrorMessage = {
  id: string;
  kind: "error";
  message: string;
  assistantId: string;
  retryable: boolean;
};
export type QueryPreviewItem = QueryPreview & {
  id: string;
  kind: "query_preview";
  savedQueryId?: string;
  savedQueryName?: string;
  stale?: boolean;
  staleReason?: "dynamic_period_mismatch";
  ownerMessageId?: string;
};
export type DashboardPreviewQuery = {
  rows: Record<string, unknown>[];
  rowLimit: number;
  byteLimit: number;
  bytes: number;
  truncated: boolean;
  truncationReason: "row_limit" | "byte_limit" | null;
  error?: string;
  previewPending?: string;
};
export type DashboardPreviewItem = {
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
  componentChanges: Record<string, "added" | "modified" | "unchanged">;
  requiresTruncationAcknowledgement: boolean;
  queries: Record<string, DashboardPreviewQuery>;
  saved?: boolean;
  stale?: boolean;
  saving?: boolean;
  ownerMessageId?: string;
};
export type ChatItem =
  | ChatMessage
  | ToolMessage
  | ProposalMessage
  | ContextProposalMessage
  | ErrorMessage
  | QueryPreviewItem
  | DashboardPreviewItem
  | QuestionnaireChatItem;
export type ChatActionCardItem =
  | ProposalMessage
  | ContextProposalMessage
  | QueryPreviewItem
  | DashboardPreviewItem
  | QuestionnaireChatItem;
export type ChatRoleMessage = { role: "user" | "assistant"; content: string };

export function getActionCardReference(item: ChatItem): ChatActionCardRef | undefined {
  switch (item.kind) {
    case "proposal":
    case "context_proposal":
    case "query_preview":
    case "dashboard_preview":
    case "questionnaire":
      return { id: item.id, kind: item.kind };
    default:
      return undefined;
  }
}

export function withActionCardOwner(
  item: ChatActionCardItem,
  ownerMessageId: string,
): ChatActionCardItem {
  return { ...item, ownerMessageId };
}

export function isActionCardItem(item: ChatItem): item is ChatActionCardItem {
  return getActionCardReference(item) !== undefined;
}

export function normalizeQueryPreviewName(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export type AiContinuation =
  | { type: "query_saved"; queryId: string; queryName: string }
  | {
      type: "dashboard_saved";
      dashboardId: string;
      dashboardName: string;
      mode: "create" | "update";
    };
export type AiPageContext = {
  pathname: string;
  dashboardId?: string;
  dashboardName?: string;
};
export type SavedQueryReference = { id: string; name: string };
export type SendOptions = {
  content?: string;
  retry?: boolean;
  silentUser?: boolean;
  continuation?: AiContinuation;
  pageContext?: AiPageContext;
  savedQueryContext?: SavedQueryReference;
};

export const MAX_MESSAGE_CHARACTERS = 8_000;
export const MAX_HISTORY_MESSAGES = 30;
export const MAX_HISTORY_CHARACTERS = 32_000;
export const MIN_AI_CHAT_WIDTH = 320;
export const MAX_AI_CHAT_WIDTH = 680;
export const DEFAULT_AI_CHAT_WIDTH = 448;
export const REFRESH_TOOL_NAME = "refresh_current_view";
export const DASHBOARD_ID_PATTERN =
  /^\/(?:dashboards|admin\/dashboards)\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/|$)/i;

export function newId() {
  return crypto.randomUUID();
}

export function pageContextForPath(pathname: string) {
  const match = DASHBOARD_ID_PATTERN.exec(pathname);
  return {
    pathname,
    ...(match ? { dashboardId: match[1] } : {}),
  };
}

export function hasPendingDashboardComponentRequest(items: ChatItem[], pathname: string) {
  const userMessages = items.filter(
    (item): item is ChatMessage => item.kind === "message" && item.role === "user",
  );
  const latest = userMessages.at(-1)?.content ?? "";
  const normalizedLatest = latest
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const isQuestionnaireAnswer = /\b(respostas? ao formulario|respostas enviadas)\b/.test(normalizedLatest);
  const text = [
    ...(isQuestionnaireAnswer ? [userMessages.at(-2)?.content ?? ""] : []),
    latest,
  ].join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const asksForAction = /\b(adicionar|adicione|adiciona|inclui|inclua|incluir|criar|crie|montar|monte|colocar|coloque|inserir|insira|gerar|gere|faca|fazer)\b/.test(text);
  const asksForComponent = /\b(graficos?|dashboards?|paineis|componentes?|tabelas?|indicadores?|metricas?|kpis?)\b/.test(text);
  const requestsComponent = /\b(quero|preciso)\b/.test(text) && asksForComponent;
  const placementInstruction = /\b(ao lado(?: direito| esquerdo)?|a direita|a esquerda|acima|abaixo|antes|depois|apos)\b/.test(text);
  const metricDescription = /\b(somatoria|soma|total|quantidade|indicador|metrica|kpi)\b/.test(text);
  const dashboardContext = DASHBOARD_ID_PATTERN.test(pathname);
  const isConcreteVisualizationRequest = (requestText: string) => {
    const normalizedRequest = requestText
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return /\b(graficos?|tabelas?|indicadores?|metricas?|kpis?)\b/.test(normalizedRequest)
      && /\b(top\s*\d+|maiores?|menores?|por\s+(?:venda|faturamento|categoria|estado|cidade)|venda|faturamento)\b/.test(normalizedRequest);
  };
  const recentConcreteVisualization = userMessages.slice(-6, -1).some(
    (message) => isConcreteVisualizationRequest(message.content),
  );
  const confirmsImplementation = /\b(pode|poderia|vamos|sim)\b.{0,32}\b(implementar|implemente|adicionar|incluir|montar|criar)\b/.test(normalizedLatest)
    && recentConcreteVisualization;
  const isDashboardRequest = (requestText: string) => {
    const normalizedRequest = requestText
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const action = /\b(adicionar|adicione|adiciona|inclui|inclua|incluir|criar|crie|montar|monte|colocar|coloque|inserir|insira|gerar|gere|faca|fazer)\b/.test(normalizedRequest);
    const component = /\b(graficos?|dashboards?|paineis|componentes?|tabelas?|indicadores?|metricas?|kpis?)\b/.test(normalizedRequest);
    const wantsComponent = /\b(quero|preciso)\b/.test(normalizedRequest) && component;
    const positionedMetric = /\b(ao lado(?: direito| esquerdo)?|a direita|a esquerda|acima|abaixo|antes|depois|apos)\b/.test(normalizedRequest)
      && /\b(somatoria|soma|total|quantidade|indicador|metrica|kpi)\b/.test(normalizedRequest);
    return (action && component)
      || wantsComponent
      || (action && positionedMetric)
      || isConcreteVisualizationRequest(requestText);
  };
  const isDirectDashboardRequest = (asksForAction && asksForComponent)
    || requestsComponent
    || (asksForAction && placementInstruction && (metricDescription || dashboardContext));
  if (isDirectDashboardRequest || isDashboardRequest(text) || confirmsImplementation) return true;
  const latestIsStatusFollowUp = /^[?!.…\s]+$/.test(normalizedLatest)
    || (/\b(aplicar|visualizar|proposta|previ\w*|cartao|botao)\b/.test(normalizedLatest)
      && /\b(nao|tem|cade|onde|aparece|apareceu|sumiu)\b/.test(normalizedLatest));
  return (latestIsStatusFollowUp && userMessages.slice(-5, -1).some(
    (message) => isDashboardRequest(message.content),
  )) || (isQuestionnaireAnswer && recentConcreteVisualization);
}

export function completedConversation(
  items: ChatItem[],
  limits: { reserveMessages?: number; reserveCharacters?: number } = {},
): ChatRoleMessage[] {
  const available = items.flatMap((item) =>
    item.kind === "message" && item.status === "complete" && item.content.trim()
      ? [{ role: item.role, content: item.content }]
      : [],
  );

  const bounded: ChatRoleMessage[] = [];
  let characters = 0;
  const maxMessages = Math.max(
    0,
    MAX_HISTORY_MESSAGES - (limits.reserveMessages ?? 0),
  );
  const maxCharacters = Math.max(
    0,
    MAX_HISTORY_CHARACTERS - (limits.reserveCharacters ?? 0),
  );
  const recentMessages = maxMessages === 0 ? [] : available.slice(-maxMessages);
  for (const message of recentMessages.reverse()) {
    const content = message.content.slice(-MAX_MESSAGE_CHARACTERS);
    if (characters + content.length > maxCharacters) break;
    bounded.push({ role: message.role, content });
    characters += content.length;
  }
  return bounded.reverse();
}

export function toolLabel(toolName: string) {
  const labels: Record<string, string> = {
    list_data_sources: "Consultando servidores",
    list_data_source_tables: "Listando tabelas disponíveis",
    get_data_source_table_schema: "Lendo colunas e contexto da tabela",
    analyze_date_coverage: "Analisando cobertura de datas",
    analyze_column_values: "Analisando valores dos dados",
    get_current_context: "Lendo contexto da tela",
    test_query: "Testando consulta",
    save_query: "Salvando consulta",
    propose_context_update: "Preparando proposta de contexto",
    create_or_update_dashboard: "Atualizando dashboard",
    [REFRESH_TOOL_NAME]: "Atualizando componentes do dashboard",
  };
  return labels[toolName] ?? `Executando ${toolName}`;
}

export function formatElapsedTime(elapsedMs: number) {
  const seconds = Math.floor(elapsedMs / 1_000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}


export function insertBefore(current: ChatItem[], assistantId: string, item: ChatItem): ChatItem[] {
    const assistantIndex = current.findIndex(
      (candidate) =>
        candidate.kind === "message" && candidate.id === assistantId,
    );
    const index = assistantIndex < 0 ? current.length : assistantIndex;
    return [...current.slice(0, index), item, ...current.slice(index)];
}

export function insertAfter(current: ChatItem[], assistantId: string, item: ChatItem): ChatItem[] {
    const reference = getActionCardReference(item);
    const originalAssistant = current.find(
      (candidate) =>
        candidate.kind === "message" && candidate.id === assistantId,
    ) ?? [...current].reverse().find(
      (candidate): candidate is ChatMessage =>
        candidate.kind === "message" && candidate.role === "assistant",
    );
    if (!originalAssistant || originalAssistant.kind !== "message")
      return [...current, item];
    const ownerMessageId = originalAssistant.id;

    let next = current;
    let attachedItem = item;
    if (reference && isActionCardItem(item)) {
      const displacedCardIds = new Set([
        reference.id,
        originalAssistant.actionCard?.id,
      ]);
      next = current
        .filter(
          (candidate) =>
            !isActionCardItem(candidate) ||
            !displacedCardIds.has(candidate.id),
        )
        .map((candidate) => {
          if (candidate.kind !== "message") return candidate;
          if (candidate.id === ownerMessageId)
            return { ...candidate, actionCard: reference };
          if (
            candidate.actionCard &&
            displacedCardIds.has(candidate.actionCard.id)
          ) {
            const message = { ...candidate };
            delete message.actionCard;
            return message;
          }
          return candidate;
        });
      attachedItem = withActionCardOwner(item, ownerMessageId);
    }

    const assistantIndex = next.findIndex(
      (candidate) =>
        candidate.kind === "message" && candidate.id === ownerMessageId,
    );

    let index = assistantIndex + 1;
    while (index < next.length && next[index]?.kind !== "message") {
      index += 1;
    }
    return [
      ...next.slice(0, index),
      attachedItem,
      ...next.slice(index),
    ];
}

export function mergePendingContextProposals(
  current: ChatItem[],
  proposals: AiContextProposal[],
): ChatItem[] {
  const pending = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const existing = current.map((item) => {
    if (item.kind !== "context_proposal") return item;
    const latest = pending.get(item.id);
    if (!latest) return item;
    pending.delete(item.id);
    return { ...item, proposal: latest };
  });
  return [
    ...existing,
    ...[...pending.values()].map((proposal) => ({
      id: proposal.id,
      kind: "context_proposal" as const,
      proposal,
    })),
  ];
}
