import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { api, ApiError } from "@/api";
import {
  Bot,
  Check,
  CircleAlert,
  LoaderCircle,
  PanelRightClose,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Message,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { useCurrentViewRefresh } from "@/context/CurrentViewRefreshContext";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import type { QueryPreview } from "@/types";
import type { DashboardDefinition, DashboardDocument } from "@/types";
import { DashboardProposalCanvas } from "@/dashboard";

type ChatMessage = {
  id: string;
  kind: "message";
  role: "user" | "assistant";
  content: string;
  status: "complete" | "streaming" | "stopped" | "error";
};

type ToolMessage = {
  id: string;
  kind: "tool";
  toolName: string;
  status: "running" | "success" | "failed";
};

type ProposalMessage = {
  id: string;
  kind: "proposal";
  title: string;
  summary: string;
};

type ErrorMessage = {
  id: string;
  kind: "error";
  message: string;
  assistantId: string;
  retryable: boolean;
};
type QueryPreviewItem = QueryPreview & {
  id: string;
  kind: "query_preview";
  savedQueryId?: string;
  stale?: boolean;
};
type DashboardPreviewQuery = {
  rows: Record<string, unknown>[];
  rowLimit: number;
  byteLimit: number;
  bytes: number;
  truncated: boolean;
  truncationReason: "row_limit" | "byte_limit" | null;
  error?: string;
};
type DashboardPreviewItem = {
  id: string;
  kind: "dashboard_preview";
  toolCallId: string;
  proposalId: string;
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
type ChatItem = ChatMessage | ToolMessage | ProposalMessage | ErrorMessage | QueryPreviewItem | DashboardPreviewItem;
type ChatRoleMessage = { role: "user" | "assistant"; content: string };

type ChatEvent =
  | { version: 1; type: "start"; requestId: string; messageId: string }
  | { version: 1; type: "token"; messageId: string; delta: string }
  | { version: 1; type: "tool_start"; toolCallId: string; toolName: string }
  | {
      version: 1;
      type: "tool_result";
      toolCallId: string;
      toolName: string;
      ok: boolean;
    }
  | ({ version: 1; type: "query_preview"; toolCallId: string } & QueryPreview)
  | ({ version: 1; type: "dashboard_preview" } & Omit<DashboardPreviewItem, "id" | "kind" | "saved" | "stale">)
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

const MAX_MESSAGE_CHARACTERS = 8_000;
const MAX_HISTORY_MESSAGES = 30;
const MAX_HISTORY_CHARACTERS = 32_000;
const REFRESH_TOOL_NAME = "refresh_current_view";
const DASHBOARD_ID_PATTERN =
  /^\/(?:dashboards|admin\/dashboards)\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/|$)/i;

function newId() {
  return crypto.randomUUID();
}

function pageContextForPath(pathname: string) {
  const match = DASHBOARD_ID_PATTERN.exec(pathname);
  return {
    pathname,
    ...(match ? { dashboardId: match[1] } : {}),
  };
}

function completedConversation(items: ChatItem[]): ChatRoleMessage[] {
  const available = items.flatMap((item) =>
    item.kind === "message" && item.status === "complete" && item.content.trim()
      ? [{ role: item.role, content: item.content }]
      : [],
  );

  const bounded: ChatRoleMessage[] = [];
  let characters = 0;
  for (const message of available.slice(-MAX_HISTORY_MESSAGES).reverse()) {
    const content = message.content.slice(-MAX_MESSAGE_CHARACTERS);
    if (characters + content.length > MAX_HISTORY_CHARACTERS) break;
    bounded.push({ role: message.role, content });
    characters += content.length;
  }
  return bounded.reverse();
}

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
    throw new Error(
      "A versão do protocolo de streaming da IA não é compatível.",
    );
  }
  const type = payload.type ?? eventName;
  if (
    typeof type !== "string" ||
    (eventName !== "message" && type !== eventName)
  ) {
    throw new Error(
      "O evento de streaming da IA não corresponde ao protocolo.",
    );
  }
  const normalizedPayload = { ...payload, type };

  switch (type) {
    case "start":
      if (
        typeof payload.requestId === "string" &&
        typeof payload.messageId === "string"
      )
        return normalizedPayload as ChatEvent;
      throw new Error("O evento de início da IA está malformado.");
    case "token":
      if (
        typeof payload.messageId === "string" &&
        typeof payload.delta === "string"
      )
        return normalizedPayload as ChatEvent;
      throw new Error("O evento de texto da IA está malformado.");
    case "tool_start":
      if (
        typeof payload.toolCallId === "string" &&
        typeof payload.toolName === "string"
      )
        return normalizedPayload as ChatEvent;
      throw new Error("O evento de ferramenta da IA está malformado.");
    case "tool_result":
      if (
        typeof payload.toolCallId === "string" &&
        typeof payload.toolName === "string" &&
        typeof payload.ok === "boolean"
      )
        return normalizedPayload as ChatEvent;
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
        typeof value === "string" ||
        (Array.isArray(value) && value.every((entry) => typeof entry === "string")),
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
        Number.isSafeInteger(payload.rowCount) && (payload.rowCount as number) === rows.length &&
        Number.isSafeInteger(payload.rowLimit) && Number.isSafeInteger(payload.byteLimit) && Number.isSafeInteger(payload.bytes) &&
        typeof payload.truncated === "boolean" &&
        (payload.truncationReason === null || ["row_limit", "byte_limit"].includes(String(payload.truncationReason)) )
      ) return normalizedPayload as ChatEvent;
      throw new Error("A prévia da query está malformada.");
    }
    case "proposal":
      if (
        typeof payload.proposalId === "string" &&
        typeof payload.kind === "string" &&
        typeof payload.title === "string" &&
        typeof payload.summary === "string"
      )
        return normalizedPayload as ChatEvent;
      throw new Error("A proposta da IA está malformada.");
    case "dashboard_preview": {
      const document = payload.document;
      const definition = payload.definition;
      const queries = payload.queries;
      const validQueries = isRecord(queries) && Object.values(queries).every((query) =>
        isRecord(query) &&
        Array.isArray(query.rows) && query.rows.every(isRecord) &&
        Number.isSafeInteger(query.rowLimit) && Number.isSafeInteger(query.byteLimit) &&
        Number.isSafeInteger(query.bytes) && typeof query.truncated === "boolean" &&
        (query.truncationReason === null || ["row_limit", "byte_limit"].includes(String(query.truncationReason))) &&
        (query.error === undefined || typeof query.error === "string"),
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
        validQueries
      ) return normalizedPayload as ChatEvent;
      throw new Error("A prévia do dashboard está malformada.");
    }
    case "error":
      if (
        typeof payload.code === "string" &&
        typeof payload.message === "string" &&
        typeof payload.retryable === "boolean"
      )
        return normalizedPayload as ChatEvent;
      throw new Error("O evento de erro da IA está malformado.");
    case "done":
      if (
        typeof payload.messageId === "string" &&
        (typeof payload.finishReason === "string" ||
          payload.finishReason === null)
      )
        return normalizedPayload as ChatEvent;
      throw new Error("O evento de conclusão da IA está malformado.");
    default:
      throw new Error("A IA enviou um evento de streaming desconhecido.");
  }
}

class SseV1Parser {
  private buffer = "";
  private data: string[] = [];
  private eventName = "message";

  push(chunk: string, final = false): ChatEvent[] {
    this.buffer += chunk;
    const events: ChatEvent[] = [];
    let lineStart = 0;

    for (let index = 0; index < this.buffer.length; index += 1) {
      const character = this.buffer[index];
      if (character !== "\n" && character !== "\r") continue;
      if (character === "\r" && index === this.buffer.length - 1 && !final) {
        break;
      }

      this.consumeLine(this.buffer.slice(lineStart, index), events);
      if (character === "\r" && this.buffer[index + 1] === "\n") index += 1;
      lineStart = index + 1;
    }

    this.buffer = this.buffer.slice(lineStart);
    if (final) {
      if (this.buffer.length) this.consumeLine(this.buffer, events);
      this.buffer = "";
      this.consumeLine("", events);
    }
    return events;
  }

  private consumeLine(line: string, events: ChatEvent[]) {
    if (line === "") {
      if (this.data.length) {
        const event = decodeEvent(this.eventName, this.data.join("\n"));
        if (event) events.push(event);
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
}

async function readChatStream(
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
      for (const event of parser.push(
        decoder.decode(value, { stream: true }),
      )) {
        onEvent(event);
      }
    }
    const finalChunk = decoder.decode();
    for (const event of parser.push(finalChunk, true)) onEvent(event);
  } finally {
    reader.releaseLock();
  }
}

function toolLabel(toolName: string) {
  const labels: Record<string, string> = {
    list_data_sources: "Consultando servidores",
    list_data_source_tables: "Listando tabelas disponíveis",
    get_data_source_table_schema: "Lendo colunas e contexto da tabela",
    get_current_context: "Lendo contexto da tela",
    test_query: "Testando consulta",
    save_query: "Salvando consulta",
    propose_context_update: "Preparando proposta de contexto",
    create_or_update_dashboard: "Atualizando dashboard",
    [REFRESH_TOOL_NAME]: "Atualizando componentes do dashboard",
  };
  return labels[toolName] ?? `Executando ${toolName}`;
}

function DashboardPreviewCard({
  item,
  busy,
  onApply,
}: {
  item: DashboardPreviewItem;
  busy: boolean;
  onApply: (acknowledgeTruncation: boolean) => void;
}) {
  const [acknowledgedLimit, setAcknowledgedLimit] = useState(false);
  const [expired, setExpired] = useState(false);
  const truncated = Object.values(item.queries).some((query) => query.truncated);

  useEffect(() => {
    setAcknowledgedLimit(false);
    const remaining = new Date(item.expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      setExpired(true);
      return;
    }
    setExpired(false);
    const timer = window.setTimeout(() => setExpired(true), remaining);
    return () => window.clearTimeout(timer);
  }, [item.id, item.expiresAt]);

  const componentTitles = item.definition.components.map((component) => component.title);
  const queryCount = Object.keys(item.queries).length;
  const unavailable = !item.canCommit || item.saved || item.stale || item.saving || expired || (truncated && !acknowledgedLimit) || busy;
  return (
    <section className="mx-3 flex min-w-0 flex-col gap-3 border border-primary/30 bg-primary/5 p-3 text-sm sm:mx-4">
      <header className="min-w-0">
        <p className="font-semibold">
          {item.mode === "create" ? "Prévia de novo dashboard" : "Proposta de alterações"}
        </p>
        <h3 className="mt-1 break-words text-base font-semibold">{item.document.name}</h3>
        {item.document.description && (
          <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{item.document.description}</p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {componentTitles.length} componentes · {queryCount} queries salvas · revisão em {new Date(item.expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {componentTitles.map((title, index) => (
            <li key={`${title}-${index}`} className="max-w-full truncate rounded border bg-background px-2 py-0.5 text-xs">{title}</li>
          ))}
        </ul>
        <div className="mt-3 border-t border-primary/15 pt-2 text-xs">
          <p className="font-medium">Resumo das alterações</p>
          <ul className="mt-1 list-disc pl-4 text-muted-foreground">
            {item.changeSummary.map((change, index) => <li key={`${index}-${change}`}>{change}</li>)}
          </ul>
        </div>
      </header>

      <DashboardProposalCanvas definition={item.definition} rowsByQuery={item.queries} />

      {item.issues.length > 0 && (
        <div role="alert" className="border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          <p className="font-medium">A prévia precisa de ajustes antes de confirmar</p>
          <ul className="mt-1 list-disc pl-4">
            {item.issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}
          </ul>
        </div>
      )}

      {truncated && (
        <Label className="flex items-start gap-2 border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
          <Checkbox checked={acknowledgedLimit} onCheckedChange={(checked) => setAcknowledgedLimit(checked === true)} />
          <span>
            A prévia de dados foi limitada. Revise os componentes sabendo que a amostra está truncada antes de confirmar.
            <ul className="mt-1 list-disc pl-4">
              {Object.entries(item.queries).filter(([, query]) => query.truncated).map(([queryId, query]) => (
                <li key={queryId}>
                  Query {queryId.slice(0, 8)}…: {query.rows.length}/{query.rowLimit} linhas · {query.bytes}/{query.byteLimit} bytes ({query.truncationReason}).
                </li>
              ))}
            </ul>
          </span>
        </Label>
      )}

      <footer className="flex flex-col gap-2 border-t border-primary/15 pt-3 sm:flex-row sm:items-center sm:justify-between">
        {item.saved ? (
          <span className="text-xs text-emerald-700 dark:text-emerald-400">Dashboard salvo.</span>
        ) : item.stale || expired ? (
          <span className="text-xs text-muted-foreground">Prévia expirada ou desatualizada. Gere uma nova proposta.</span>
        ) : (
          <span className="text-xs text-muted-foreground">Nenhuma alteração é aplicada antes de confirmar.</span>
        )}
        {!item.saved && (
          <Button size="sm" className="w-full sm:w-auto" disabled={unavailable} onClick={() => onApply(acknowledgedLimit)}>
            {item.saving ? "Salvando…" : item.mode === "create" ? "Criar dashboard" : `Aplicar alterações em ${item.document.name}`}
          </Button>
        )}
      </footer>
    </section>
  );
}

function ChatItemView({
  item,
  busy,
  onRetry,
  onReviewPreview,
  onApplyDashboard,
}: {
  item: ChatItem;
  busy: boolean;
  onRetry: () => void;
  onReviewPreview: (item: QueryPreviewItem) => void;
  onApplyDashboard: (item: DashboardPreviewItem, acknowledgeTruncation: boolean) => void;
}) {
  if (item.kind === "tool") {
    const success = item.status === "success";
    const running = item.status === "running";
    return (
      <Marker role="status" className="px-4 py-1.5 text-xs">
        <MarkerIcon>
          {running ? (
            <LoaderCircle className="animate-spin" />
          ) : success ? (
            <Check />
          ) : (
            <Wrench />
          )}
        </MarkerIcon>
        <MarkerContent className={running ? "shimmer" : undefined}>
          {toolLabel(item.toolName)}
          {running ? "…" : success ? " · concluído" : " · falhou"}
        </MarkerContent>
      </Marker>
    );
  }

  if (item.kind === "query_preview") {
    return (
      <div className="mx-4 border border-primary/30 bg-primary/5 p-3 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">Prévia de {item.intent.mode === "update" ? "edição" : "nova query"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {item.dataSource.name} · {item.intent.queryName} · {item.rowCount}/{item.rowLimit} linhas · {item.bytes}/{item.byteLimit} bytes
              {item.truncated ? ` · amostra truncada (${item.truncationReason})` : ""}
            </p>
          </div>
          {item.savedQueryId ? (
            <span className="shrink-0 text-xs text-muted-foreground">Salva · {item.savedQueryId}</span>
          ) : item.stale ? (
            <span className="shrink-0 text-xs text-muted-foreground">Prévia substituída · teste novamente</span>
          ) : (
            <Button variant="outline" size="sm" onClick={() => onReviewPreview(item)}>
              Revisar e confirmar
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (item.kind === "dashboard_preview") {
    return (
      <DashboardPreviewCard
        item={item}
        busy={busy}
        onApply={(acknowledgeTruncation) => onApplyDashboard(item, acknowledgeTruncation)}
      />
    );
  }

  if (item.kind === "proposal") {
    return (
      <div className="mx-4 border border-primary/30 bg-primary/5 p-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <Sparkles className="size-4 text-primary" />
          {item.title}
        </div>
        <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
          {item.summary}
        </p>
        <p className="mt-3 border-t border-primary/15 pt-2 text-xs text-muted-foreground">
          Proposta aguardando confirmação. Nenhuma alteração foi aplicada.
        </p>
      </div>
    );
  }

  if (item.kind === "error") {
    return (
      <div
        role="alert"
        className="mx-4 flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
      >
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p>{item.message}</p>
          {item.retryable && (
            <Button
              variant="outline"
              size="xs"
              className="mt-2 border-destructive/30 text-destructive hover:bg-destructive/10"
              onClick={onRetry}
              disabled={busy}
            >
              <RefreshCw /> Tentar novamente
            </Button>
          )}
        </div>
      </div>
    );
  }

  const isUser = item.role === "user";
  const content =
    item.content ||
    (item.status === "complete" ? "A IA finalizou sem texto." : "");
  return (
    <Message align={isUser ? "end" : "start"} className="px-4">
      <MessageContent className="max-w-full">
        <MessageHeader className={cn(isUser && "justify-end")}>
          {isUser ? "Você" : "Assistente"}
        </MessageHeader>
        {content && (
          <Bubble
            align={isUser ? "end" : "start"}
            variant={isUser ? "default" : "muted"}
          >
            <BubbleContent>{content}</BubbleContent>
          </Bubble>
        )}
        {item.status === "stopped" && (
          <span className="px-3 text-xs text-muted-foreground">
            Geração interrompida.
          </span>
        )}
        {!isUser && item.status === "complete" && (
          <MessageFooter className="gap-1 px-3">
            <Check className="size-3" /> Concluído
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}

function ChatWindow({
  items,
  busy,
  draft,
  pageLabel,
  onDraftChange,
  onSend,
  onRetry,
  onStop,
  onClear,
  onClose,
  onPreviewSaved,
  onApplyDashboard,
}: {
  items: ChatItem[];
  busy: boolean;
  draft: string;
  pageLabel: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onRetry: () => void;
  onStop: () => void;
  onClear: () => void;
  onClose: () => void;
  onPreviewSaved: (testRunId: string, queryId: string) => void;
  onApplyDashboard: (item: DashboardPreviewItem, acknowledgeTruncation: boolean) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [reviewPreview, setReviewPreview] = useState<QueryPreviewItem>();
  const [reviewName, setReviewName] = useState("");
  const [savingPreview, setSavingPreview] = useState(false);
  const [stalePreview, setStalePreview] = useState(false);
  const [reloadedQuery, setReloadedQuery] = useState<{ name: string; sqlText: string }>();
  const savePendingRef = useRef(false);
  const { hasPermission } = useAuth();

  useEffect(() => {
    setReviewName(reviewPreview?.intent.queryName ?? "");
    setStalePreview(false);
    setReloadedQuery(undefined);
  }, [reviewPreview?.id]);

  useEffect(() => {
    if (reviewPreview && items.some((item) => item.kind === "query_preview" && item.testRunId === reviewPreview.testRunId && item.stale)) {
      setStalePreview(true);
    }
  }, [items, reviewPreview]);

  const canSavePreview = reviewPreview
    ? reviewPreview.intent.mode === "create"
      ? hasPermission("queries:create")
      : hasPermission("queries:update")
    : false;

  const savePreview = async () => {
    if (!reviewPreview || savePendingRef.current || stalePreview) return;
    if (!canSavePreview) {
      toast.error("Você não tem permissão para salvar esta ação.");
      return;
    }
    if (reviewName.trim().length < 2) {
      toast.error("Informe um nome com pelo menos 2 caracteres.");
      return;
    }
    savePendingRef.current = true;
    setSavingPreview(true);
    try {
      const body = {
        dataSourceId: reviewPreview.dataSource.id,
        name: reviewName.trim(),
        sqlText: reviewPreview.sqlText,
        parameters: reviewPreview.parameters,
        testRunId: reviewPreview.testRunId,
      };
      const saved = reviewPreview.intent.mode === "update"
        ? await api.updateQuery(reviewPreview.intent.queryId!, {
            ...body,
            expectedUpdatedAt: reviewPreview.intent.queryUpdatedAt!,
          })
        : await api.createQuery(body);
      onPreviewSaved(reviewPreview.testRunId, saved.id);
      window.dispatchEvent(new Event("queries:saved"));
      toast.success(reviewPreview.intent.mode === "update" ? "Edição da query aplicada." : "Nova query salva.");
      setReviewPreview(undefined);
    } catch (reason) {
      setStalePreview(true);
      if (reason instanceof ApiError && reason.status === 409 && reviewPreview.intent.queryId) {
        try {
          const latest = await api.savedQuery(reviewPreview.intent.queryId);
          setReloadedQuery({ name: latest.name, sqlText: latest.sqlText });
        } catch {
          setReloadedQuery(undefined);
        }
        toast.error("A query mudou depois do teste. Recarreguei a versão atual; peça ao assistente para testar novamente.");
      } else {
        toast.error(reason instanceof Error ? reason.message : "Não foi possível salvar a query. Gere uma nova prévia.");
      }
    } finally {
      savePendingRef.current = false;
      setSavingPreview(false);
    }
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
  }, [draft]);

  const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      if (!busy && draft.trim()) onSend();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center border bg-primary/10 text-primary">
          <Bot className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">Assistente de IA</h2>
          <p className="truncate text-xs text-muted-foreground">{pageLabel}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClear}
          disabled={items.length === 0 && !busy}
          aria-label="Limpar conversa"
          title="Limpar conversa"
        >
          <Trash2 />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Fechar chat"
          title="Fechar chat"
        >
          <X />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex size-12 items-center justify-center border bg-muted/40">
              <Sparkles className="size-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">Vamos montar seu dashboard?</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                Peça ajuda para explorar os dados, testar consultas ou planejar
                visualizações.
              </p>
            </div>
          </div>
        ) : (
          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <MessageScroller className="flex-1">
              <MessageScrollerViewport aria-label="Mensagens da conversa">
                <MessageScrollerContent aria-busy={busy} className="gap-5 py-4">
                  {items.map((item) => (
                    <MessageScrollerItem
                      key={item.id}
                      messageId={item.id}
                      scrollAnchor={
                        item.kind === "message" && item.role === "user"
                      }
                    >
                      <ChatItemView
                        item={item}
                        busy={busy}
                        onRetry={onRetry}
                        onReviewPreview={setReviewPreview}
                        onApplyDashboard={onApplyDashboard}
                      />
                    </MessageScrollerItem>
                  ))}
                  {busy &&
                    !items.some(
                      (item) =>
                        item.kind === "tool" && item.status === "running",
                    ) && (
                      <MessageScrollerItem messageId="assistant-thinking">
                        <Marker role="status" className="px-4 text-xs">
                          <MarkerIcon>
                            <LoaderCircle className="animate-spin" />
                          </MarkerIcon>
                          <MarkerContent className="shimmer">
                            Pensando…
                          </MarkerContent>
                        </Marker>
                      </MessageScrollerItem>
                    )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        )}
      </div>

      <div className="shrink-0 border-t p-3">
        <div className="flex items-end gap-2 border bg-background p-2 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/40">
          <Textarea
            ref={textareaRef}
            value={draft}
            rows={1}
            maxLength={MAX_MESSAGE_CHARACTERS}
            placeholder="Pergunte sobre seus dados…"
            className="max-h-36 min-h-9 resize-none border-0 bg-transparent px-1 py-2 shadow-none focus-visible:ring-0"
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={submitOnEnter}
            aria-label="Mensagem para a IA"
          />
          {busy ? (
            <Button
              variant="destructive"
              size="icon"
              onClick={onStop}
              aria-label="Parar geração"
              title="Parar geração"
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={onSend}
              disabled={!draft.trim()}
              aria-label="Enviar mensagem"
              title="Enviar mensagem"
            >
              <Send />
            </Button>
          )}
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Enter envia · Shift+Enter quebra linha
        </p>
      </div>
      <Dialog open={Boolean(reviewPreview)} onOpenChange={(open) => { if (!open && !savingPreview) setReviewPreview(undefined); }}>
        <DialogContent className="flex max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Revisar prévia da query</DialogTitle>
            <DialogDescription>
              Confirme o servidor, a ação, os valores usados e a amostra antes de salvar. A resposta em texto da IA não confirma nenhuma alteração.
            </DialogDescription>
          </DialogHeader>
          {reviewPreview && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-2 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <p><strong>Servidor:</strong> {reviewPreview.dataSource.name}</p>
                <p><strong>Ação:</strong> {reviewPreview.intent.mode === "update" ? `Editar ${reviewPreview.intent.queryId}` : "Criar query"}</p>
              </div>
              <label className="flex flex-col gap-2 text-sm font-medium">
                Nome da query
                <Input value={reviewName} maxLength={160} minLength={2} onChange={(event) => setReviewName(event.target.value)} disabled={savingPreview} />
              </label>
              <div className="rounded border bg-muted/40 p-3">
                <p className="font-medium">SQL testado</p>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">{reviewPreview.sqlText}</pre>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded border p-3">
                  <p className="font-medium">Definições dos parâmetros</p>
                  <pre className="mt-2 max-h-36 overflow-auto text-xs">{JSON.stringify(reviewPreview.parameters, null, 2)}</pre>
                </div>
                <div className="rounded border p-3">
                  <p className="font-medium">Valores usados no teste</p>
                  <pre className="mt-2 max-h-36 overflow-auto text-xs">{JSON.stringify(reviewPreview.testValues, null, 2)}</pre>
                </div>
              </div>
              <div className="rounded border p-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="font-medium">Amostra retornada · {reviewPreview.rowCount} linhas</p>
                  <p className="text-xs text-muted-foreground">
                    Limite {reviewPreview.rowLimit} linhas / {reviewPreview.byteLimit} bytes · {reviewPreview.bytes} bytes usados
                    {reviewPreview.truncated ? ` · truncada (${reviewPreview.truncationReason})` : ""}
                  </p>
                </div>
                <pre className="mt-2 max-h-56 overflow-auto text-xs">{JSON.stringify(reviewPreview.rows, null, 2)}</pre>
              </div>
              {stalePreview && (
                <div role="alert" className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  Esta prévia não pode mais ser usada. Teste novamente antes de salvar.
                  {reloadedQuery && <><p className="mt-2 font-medium">Versão atual recarregada: {reloadedQuery.name}</p><pre className="mt-1 max-h-24 overflow-auto text-xs">{reloadedQuery.sqlText}</pre></>}
                </div>
              )}
              {!canSavePreview && <p className="text-xs text-muted-foreground">Sua conta não tem a permissão necessária para salvar esta query.</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewPreview(undefined)} disabled={savingPreview}>Cancelar</Button>
            <Button onClick={() => void savePreview()} disabled={!reviewPreview || savingPreview || stalePreview || !canSavePreview || reviewName.trim().length < 2}>
              {savingPreview ? "Salvando…" : reviewPreview?.intent.mode === "update" ? "Aplicar edição" : "Salvar nova query"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AiChatDock({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const refreshCurrentView = useCurrentViewRefresh();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const activeAssistantIdRef = useRef<string | null>(null);
  const lastPromptRef = useRef("");
  const pathRef = useRef(location.pathname);
  const refreshedToolCallsRef = useRef(new Set<string>());
  const dashboardSavePendingRef = useRef(new Set<string>());
  pathRef.current = location.pathname;

  useEffect(
    () => () => {
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  const updateAssistant = useCallback(
    (assistantId: string, update: (message: ChatMessage) => ChatMessage) => {
      setItems((current) =>
        current.map((item) =>
          item.kind === "message" && item.id === assistantId
            ? update(item)
            : item,
        ),
      );
    },
    [],
  );

  const insertBeforeAssistant = useCallback(
    (assistantId: string, item: ChatItem) => {
      setItems((current) => {
        const assistantIndex = current.findIndex(
          (candidate) =>
            candidate.kind === "message" && candidate.id === assistantId,
        );
        const index = assistantIndex < 0 ? current.length : assistantIndex;
        return [...current.slice(0, index), item, ...current.slice(index)];
      });
    },
    [],
  );

  const handleEvent = useCallback(
    (
      event: ChatEvent,
      assistantId: string,
      requestPath: string,
      generation: number,
    ) => {
      if (generation !== generationRef.current) return;

      switch (event.type) {
        case "start":
          return;
        case "token":
          updateAssistant(assistantId, (message) => ({
            ...message,
            content: message.content + event.delta,
            status: "streaming",
          }));
          return;
        case "tool_start":
          insertBeforeAssistant(assistantId, {
            id: event.toolCallId,
            kind: "tool",
            toolName: event.toolName,
            status: "running",
          });
          return;
        case "tool_result":
          setItems((current) => {
            const index = current.findIndex(
              (item) => item.kind === "tool" && item.id === event.toolCallId,
            );
            if (index < 0) {
              const tool: ToolMessage = {
                id: event.toolCallId,
                kind: "tool",
                toolName: event.toolName,
                status: event.ok ? "success" : "failed",
              };
              const assistantIndex = current.findIndex(
                (item) => item.kind === "message" && item.id === assistantId,
              );
              const insertionIndex =
                assistantIndex < 0 ? current.length : assistantIndex;
              return [
                ...current.slice(0, insertionIndex),
                tool,
                ...current.slice(insertionIndex),
              ];
            }
            return current.map((item) =>
              item.kind === "tool" && item.id === event.toolCallId
                ? { ...item, status: event.ok ? "success" : "failed" }
                : item,
            );
          });
          if (
            event.ok &&
            event.toolName === REFRESH_TOOL_NAME &&
            !refreshedToolCallsRef.current.has(event.toolCallId) &&
            pathRef.current === requestPath &&
            /^\/dashboards\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              pathRef.current,
            )
          ) {
            refreshedToolCallsRef.current.add(event.toolCallId);
            refreshCurrentView();
          }
          return;
        case "query_preview":
          setItems((current) => current.map((item) => {
            if (item.kind !== "query_preview" || item.savedQueryId) return item;
            const draftChanged =
              item.dataSource.id !== event.dataSource.id ||
              item.sqlText !== event.sqlText ||
              JSON.stringify(item.parameters) !== JSON.stringify(event.parameters) ||
              JSON.stringify(item.testValues) !== JSON.stringify(event.testValues) ||
              item.intent.mode !== event.intent.mode ||
              item.intent.queryId !== event.intent.queryId;
            return draftChanged ? { ...item, stale: true } : item;
          }));
          insertBeforeAssistant(assistantId, {
            id: event.testRunId,
            kind: "query_preview",
            testRunId: event.testRunId,
            dataSource: event.dataSource,
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
          return;
        case "proposal":
          insertBeforeAssistant(assistantId, {
            id: event.proposalId,
            kind: "proposal",
            title: event.title,
            summary: event.summary,
          });
          return;
        case "dashboard_preview":
          setItems((current) => current.map((item) =>
            item.kind === "dashboard_preview" && !item.saved && item.dashboardId === event.dashboardId
              ? { ...item, stale: true }
              : item,
          ));
          insertBeforeAssistant(assistantId, {
            ...event,
            id: event.proposalId,
            kind: "dashboard_preview",
          });
          return;
        case "error":
          updateAssistant(assistantId, (message) => ({
            ...message,
            status: "error",
          }));
          insertBeforeAssistant(assistantId, {
            id: newId(),
            kind: "error",
            assistantId,
            retryable: event.retryable,
            message: event.message,
          });
          return;
        case "done":
          updateAssistant(assistantId, (message) => ({
            ...message,
            status: "complete",
          }));
      }
    },
    [insertBeforeAssistant, refreshCurrentView, updateAssistant],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    generationRef.current += 1;
    setBusy(false);
    const assistantId = activeAssistantIdRef.current;
    if (assistantId) {
      updateAssistant(assistantId, (message) => ({
        ...message,
        status: "stopped",
      }));
    }
    activeAssistantIdRef.current = null;
  }, [updateAssistant]);

  const send = useCallback(
    async (retryPrompt?: string) => {
      const retrying = retryPrompt !== undefined;
      const content = (retryPrompt ?? draft).trim();
      if (!content || busy) return;

      const userMessage: ChatMessage = {
        id: newId(),
        kind: "message",
        role: "user",
        content,
        status: "complete",
      };
      const assistantMessage: ChatMessage = {
        id: newId(),
        kind: "message",
        role: "assistant",
        content: "",
        status: "streaming",
      };
      const conversation = completedConversation(items);
      if (!retrying) conversation.push({ role: "user", content });
      const requestPath = location.pathname;
      const pageContext = pageContextForPath(requestPath);
      const baseUrl = (
        import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000"
      ).replace(/\/$/, "");
      const controller = new AbortController();
      const generation = ++generationRef.current;

      abortRef.current?.abort();
      abortRef.current = controller;
      activeAssistantIdRef.current = assistantMessage.id;
      lastPromptRef.current = content;
      refreshedToolCallsRef.current.clear();
      setItems((current) => {
        if (!retrying) return [...current, userMessage, assistantMessage];
        const failedAssistantId = [...current]
          .reverse()
          .find(
            (item) =>
              item.kind === "message" &&
              item.role === "assistant" &&
              item.status === "error",
          )?.id;
        return [
          ...current.filter(
            (item) =>
              item.id !== failedAssistantId &&
              !(
                item.kind === "error" && item.assistantId === failedAssistantId
              ),
          ),
          assistantMessage,
        ];
      });
      setDraft("");
      setBusy(true);

      try {
        const response = await fetch(`${baseUrl}/api/admin/ai/chat`, {
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "text/event-stream",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: conversation,
            pageContext,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const result = (await response.json().catch(() => ({}))) as {
            error?: unknown;
          };
          throw new Error(
            typeof result.error === "string"
              ? result.error
              : "Não foi possível iniciar a conversa com a IA.",
          );
        }
        if (!response.body)
          throw new Error("O servidor não iniciou o streaming da IA.");

        let receivedDone = false;
        let receivedError = false;
        await readChatStream(response.body, (event) => {
          if (event.type === "done") receivedDone = true;
          if (event.type === "error") receivedError = true;
          handleEvent(event, assistantMessage.id, requestPath, generation);
        });
        if (!receivedDone && !receivedError) {
          throw new Error(
            "A conexão foi encerrada antes de a IA concluir a resposta.",
          );
        }
        if (generation === generationRef.current) {
          updateAssistant(assistantMessage.id, (message) =>
            message.status === "error" || message.status === "complete"
              ? message
              : { ...message, status: receivedDone ? "complete" : "error" },
          );
        }
      } catch (reason) {
        if (generation !== generationRef.current) return;
        if (reason instanceof DOMException && reason.name === "AbortError") {
          updateAssistant(assistantMessage.id, (message) => ({
            ...message,
            status: "stopped",
          }));
        } else {
          updateAssistant(assistantMessage.id, (message) => ({
            ...message,
            status: "error",
          }));
          setItems((current) => [
            ...current,
            {
              id: newId(),
              kind: "error",
              assistantId: assistantMessage.id,
              retryable: true,
              message:
                reason instanceof Error
                  ? reason.message
                  : "A conexão com a IA falhou.",
            },
          ]);
        }
      } finally {
        if (generation === generationRef.current) {
          setBusy(false);
          abortRef.current = null;
          activeAssistantIdRef.current = null;
        }
      }
    },
    [busy, draft, handleEvent, items, location.pathname, updateAssistant],
  );

  const clear = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setItems([]);
    setDraft("");
    activeAssistantIdRef.current = null;
    lastPromptRef.current = "";
    refreshedToolCallsRef.current.clear();
  }, []);

  const markQueryPreviewSaved = useCallback((testRunId: string, queryId: string) => {
    setItems((current) => current.map((item) =>
      item.kind === "query_preview" && item.testRunId === testRunId
        ? { ...item, savedQueryId: queryId }
        : item,
    ));
  }, []);

  const handleDashboardSaved = useCallback((dashboardId: string, mode: "create" | "update") => {
    const routeDashboardId = /^\/dashboards\/([^/]+)$/.exec(location.pathname)?.[1];
    if (mode === "create" || routeDashboardId?.toLowerCase() !== dashboardId.toLowerCase()) {
      navigate(`/dashboards/${dashboardId}`);
      return;
    }
    refreshCurrentView();
  }, [location.pathname, navigate, refreshCurrentView]);

  const applyDashboard = useCallback(async (item: DashboardPreviewItem, acknowledgeTruncation: boolean) => {
    if (item.saved || item.stale || dashboardSavePendingRef.current.has(item.proposalId)) return;
    if (new Date(item.expiresAt).getTime() <= Date.now()) {
      setItems((current) => current.map((candidate) =>
        candidate.kind === "dashboard_preview" && candidate.id === item.id
          ? { ...candidate, stale: true }
          : candidate,
      ));
      toast.error("A proposta expirou. Peça uma nova prévia ao assistente.");
      return;
    }
    dashboardSavePendingRef.current.add(item.proposalId);
    setItems((current) => current.map((candidate) =>
      candidate.kind === "dashboard_preview" && candidate.id === item.id
        ? { ...candidate, saving: true }
        : candidate,
    ));
    try {
      const result = await api.commitAiDashboardProposal(item.proposalId, acknowledgeTruncation);
      setItems((current) => current.map((candidate) =>
        candidate.kind === "dashboard_preview" && candidate.id === item.id
          ? { ...candidate, saved: true, saving: false }
          : candidate,
      ));
      toast.success(result.alreadyApplied
        ? "A aplicação da proposta foi confirmada."
        : result.mode === "create" ? "Dashboard criado." : "Alterações aplicadas ao dashboard.");
      handleDashboardSaved(result.id, result.mode);
    } catch (reason) {
      const conflict = reason instanceof ApiError && reason.status === 409;
      setItems((current) => current.map((candidate) =>
        candidate.kind === "dashboard_preview" && candidate.id === item.id
          ? { ...candidate, stale: conflict, saving: false }
          : candidate,
      ));
      toast.error(reason instanceof Error ? reason.message : "Não foi possível aplicar a proposta.");
    } finally {
      dashboardSavePendingRef.current.delete(item.proposalId);
      setItems((current) => current.map((candidate) =>
        candidate.kind === "dashboard_preview" && candidate.id === item.id
          ? { ...candidate, saving: false }
          : candidate,
      ));
    }
  }, [handleDashboardSaved]);

  const pageLabel = location.pathname.startsWith("/dashboards/")
    ? "Dashboard atual"
    : location.pathname.startsWith("/admin/sources")
      ? "Servidores e tabelas"
      : location.pathname.startsWith("/admin/queries")
        ? "Consultas"
        : "Plataforma de dashboards";

  const window = (
    <ChatWindow
      items={items}
      busy={busy}
      draft={draft}
      pageLabel={pageLabel}
      onDraftChange={setDraft}
      onSend={() => void send()}
      onRetry={() => void send(lastPromptRef.current)}
      onStop={stop}
      onClear={clear}
      onClose={() => onOpenChange(false)}
      onPreviewSaved={markQueryPreviewSaved}
      onApplyDashboard={applyDashboard}
    />
  );

  return (
    <div id="ai-chat-panel" className="contents">
      {isMobile ? (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent
            side="right"
            showCloseButton={false}
            className="w-[min(100vw,28rem)] max-w-none p-0 sm:max-w-none"
          >
            <SheetTitle className="sr-only">Assistente de IA</SheetTitle>
            <SheetDescription className="sr-only">
              Chat administrativo para consultas e dashboards.
            </SheetDescription>
            {window}
          </SheetContent>
        </Sheet>
      ) : (
        <aside
          aria-label="Chat com IA"
          className={cn(
            "flex min-h-0 w-[min(28rem,38vw)] shrink-0 flex-col border-l bg-background 2xl:w-[30rem]",
            !open && "hidden",
          )}
        >
          {open ? window : null}
        </aside>
      )}
    </div>
  );
}

export function AiChatTrigger({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={open ? "secondary" : "outline"}
      size="sm"
      className="ml-auto shrink-0 gap-2"
      aria-expanded={open}
      aria-controls="ai-chat-panel"
      onClick={onClick}
    >
      {open ? <PanelRightClose /> : <Sparkles />}
      <span className="hidden sm:inline">
        {open ? "Fechar IA" : "Conversar com IA"}
      </span>
      <span className="sr-only sm:hidden">
        {open ? "Fechar chat" : "Abrir chat com IA"}
      </span>
    </Button>
  );
}
