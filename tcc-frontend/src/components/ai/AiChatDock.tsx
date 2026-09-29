import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
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
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

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
type ChatItem = ChatMessage | ToolMessage | ProposalMessage | ErrorMessage;
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
    case "proposal":
      if (
        typeof payload.proposalId === "string" &&
        typeof payload.kind === "string" &&
        typeof payload.title === "string" &&
        typeof payload.summary === "string"
      )
        return normalizedPayload as ChatEvent;
      throw new Error("A proposta da IA está malformada.");
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

function ChatItemView({
  item,
  busy,
  onRetry,
}: {
  item: ChatItem;
  busy: boolean;
  onRetry: () => void;
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
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
                      <ChatItemView item={item} busy={busy} onRetry={onRetry} />
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
        case "proposal":
          insertBeforeAssistant(assistantId, {
            id: event.proposalId,
            kind: "proposal",
            title: event.title,
            summary: event.summary,
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
