import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/shared/ui/toast";
import { useCurrentViewRefresh } from "@/context/CurrentViewRefreshContext";
import {
  choseDynamicPeriod,
  previewUsesDateParameters,
  shouldInvalidateForDynamicPeriod,
  markQueryPreviewSavedOnce,
  shouldResurfaceQueryPreview,
  shouldSendPendingPreviewContext,
} from "./chat-followup";
import type { ChatEvent } from "./chat-sse";
import { applyChatEvent } from "./chat-reducer";
import type { QuestionnaireAnswers, QuestionnaireChatItem } from "./QuestionnaireCard";
import {
  type ChatItem,
  type ChatMessage,
  type QueryPreviewItem,
  type AiContinuation,
  type AiPageContext,
  type SavedQueryReference,
  type SendOptions,
  MAX_MESSAGE_CHARACTERS,
  REFRESH_TOOL_NAME,
  newId,
  pageContextForPath,
  hasPendingDashboardComponentRequest,
  completedConversation,
  toolLabel,
  formatElapsedTime,
} from "./chat-items";
import { runChatStream } from "./useChatStream";

type Session = {
  items: ChatItem[];
  setItems: Dispatch<SetStateAction<ChatItem[]>>;
  draft: string;
  setDraft: (draft: string) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setActivityProgress: (progress: string | undefined) => void;
  updateAssistant: (id: string, update: (message: ChatMessage) => ChatMessage) => void;
};

export function useChatSend(session: Session, pathname: string) {
  const {
    items, setItems, draft, setDraft, busy, setBusy, setActivityProgress, updateAssistant,
  } = session;
  const navigate = useNavigate();
  const refreshCurrentView = useCurrentViewRefresh();
  const abortRef = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const activeAssistantIdRef = useRef<string | null>(null);
  // Server-side agent memory (tool calls included) lives under this id; a new chat gets a new one.
  const threadIdRef = useRef(crypto.randomUUID());
  const lastPromptRef = useRef("");
  const lastContinuationRef = useRef<AiContinuation | undefined>(undefined);
  const lastPageContextRef = useRef<AiPageContext | undefined>(undefined);
  const lastSilentUserRef = useRef(false);
  const pathRef = useRef(pathname);
  const refreshedToolCallsRef = useRef(new Set<string>());
  pathRef.current = pathname;

  useEffect(
    () => () => {
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  const handleEvent = useCallback(
    (event: ChatEvent, assistantId: string, requestPath: string, generation: number) => {
      if (generation !== generationRef.current) return;

      switch (event.type) {
        case "start":
          activeRequestIdRef.current = event.requestId;
          setActivityProgress(`Aguardando resposta da IA · ID ${event.requestId.slice(0, 8)}`);
          return;
        case "progress": {
          const label = event.phase === "running_tool"
            ? toolLabel(event.toolName ?? "")
            : event.phase === "preparing_response"
              ? "Preparando resposta"
              : "Aguardando resposta da IA";
          setActivityProgress(`${label} · ${formatElapsedTime(event.elapsedMs)} · ID ${event.requestId.slice(0, 8)}`);
          return;
        }
        case "dashboard_applied": {
          const currentDashboardId = /^\/dashboards\/([^/]+)$/.exec(pathRef.current)?.[1];
          if (
            event.mode === "create" ||
            currentDashboardId?.toLowerCase() !== event.dashboardId.toLowerCase()
          ) {
            navigate(`/dashboards/${event.dashboardId}`);
          } else {
            refreshCurrentView();
          }
          toast.success(`Patch aplicado ao dashboard “${event.dashboardName}”.`);
          return;
        }
      }

      if (event.type === "token" || event.type === "error" || event.type === "done") {
        setActivityProgress(undefined);
      }
      setItems((current) => applyChatEvent(current, event, assistantId));
      if (
        event.type === "tool_result" &&
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
    },
    [navigate, refreshCurrentView, setActivityProgress, setItems],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    generationRef.current += 1;
    setBusy(false);
    setActivityProgress(undefined);
    activeRequestIdRef.current = null;
    const assistantId = activeAssistantIdRef.current;
    if (assistantId) {
      updateAssistant(assistantId, (message) => ({ ...message, status: "stopped" }));
    }
    activeAssistantIdRef.current = null;
  }, [setBusy, setActivityProgress, updateAssistant]);

  const send = useCallback(
    async (options?: SendOptions): Promise<boolean> => {
      const retrying = options?.retry === true;
      const content = (options?.content ?? draft).trim();
      if (!content || busy) return false;
      if (content.length > MAX_MESSAGE_CHARACTERS) {
        toast.error("A mensagem excede o limite de 8.000 caracteres.");
        return false;
      }

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
      const conversation = completedConversation(
        items,
        retrying
          ? undefined
          : { reserveMessages: 1, reserveCharacters: content.length },
      );
      if (!retrying || options?.silentUser)
        conversation.push({ role: "user", content });
      const pageContext = options?.pageContext ?? pageContextForPath(pathname);
      const requestPath = pageContext.pathname;
      const savedQueryReferences = new Map<string, SavedQueryReference>();
      for (const item of items) {
        if (item.kind !== "query_preview" || !item.savedQueryId) continue;
        savedQueryReferences.set(item.savedQueryId, {
          id: item.savedQueryId,
          name: item.savedQueryName ?? item.intent.queryName,
        });
      }
      if (options?.savedQueryContext) {
        savedQueryReferences.set(
          options.savedQueryContext.id,
          options.savedQueryContext,
        );
      }
      const savedQueryContext = [...savedQueryReferences.values()].slice(-20);
      const latestQueryPreview = [...items]
        .reverse()
        .find(
          (item): item is QueryPreviewItem =>
            item.kind === "query_preview" && !item.stale && !item.savedQueryId,
        );
      const invalidatesPendingPreview = Boolean(
        latestQueryPreview &&
          shouldInvalidateForDynamicPeriod(content, latestQueryPreview),
      );
      const shouldIncludePendingQueryContext =
        shouldSendPendingPreviewContext(content) ||
        Boolean(
          latestQueryPreview &&
            shouldResurfaceQueryPreview(
              content,
              latestQueryPreview.savedQueryName ?? latestQueryPreview.intent.queryName,
            ),
        );
      let pendingQueryPreviews =
        !retrying &&
        !options?.silentUser &&
        shouldIncludePendingQueryContext
          ? items.flatMap((item) =>
              item.kind === "query_preview" &&
              !item.savedQueryId &&
              (!item.stale || item.testRunId === latestQueryPreview?.testRunId) &&
              item.sqlText.length <= 60_000
                ? [{
                    testRunId: item.testRunId,
                    queryName: item.intent.queryName,
                    purpose: item.purpose ?? "quick_query",
                    dataSource: {
                      id: item.dataSource.id,
                      name: item.dataSource.name,
                    },
                    sqlText: item.sqlText,
                    parameters: item.parameters,
                    testValues: item.testValues,
                  }]
                : [],
            ).slice(-3)
          : undefined;
      while (
        pendingQueryPreviews?.length &&
        new TextEncoder().encode(JSON.stringify(pendingQueryPreviews)).length > 60_000
      ) {
        pendingQueryPreviews = pendingQueryPreviews.slice(1);
      }
      const controller = new AbortController();
      const generation = ++generationRef.current;

      abortRef.current?.abort();
      abortRef.current = controller;
      activeAssistantIdRef.current = assistantMessage.id;
      lastPromptRef.current = content;
      lastContinuationRef.current = options?.continuation;
      lastPageContextRef.current = pageContext;
      lastSilentUserRef.current = options?.silentUser === true;
      refreshedToolCallsRef.current.clear();
      setItems((current) => {
        const withInvalidatedPreview = invalidatesPendingPreview && latestQueryPreview
          ? current.map((item) =>
              item.kind === "query_preview" &&
              item.testRunId === latestQueryPreview.testRunId
                ? { ...item, stale: true, staleReason: "dynamic_period_mismatch" as const }
                : item,
            )
          : current;
        if (!retrying) {
          return options?.silentUser
            ? [...withInvalidatedPreview, assistantMessage]
            : [...withInvalidatedPreview, userMessage, assistantMessage];
        }
        const failedAssistantId = [...current]
          .reverse()
          .find(
            (item) =>
              item.kind === "message" &&
              item.role === "assistant" &&
              item.status === "error",
        )?.id;
        return [
          ...withInvalidatedPreview.filter(
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
      setActivityProgress("Conectando à IA…");

      try {
        const { receivedDone, receivedError } = await runChatStream(
          {
            threadId: threadIdRef.current,
            messages: conversation,
            pageContext,
            ...(savedQueryContext.length
              ? { savedQueries: savedQueryContext }
              : {}),
            ...(pendingQueryPreviews ? { pendingQueryPreviews } : {}),
            ...(options?.continuation
              ? { continuation: options.continuation }
              : {}),
          },
          controller.signal,
          (event) => {
            handleEvent(event, assistantMessage.id, requestPath, generation);
            if (
              event.type === "query_preview" &&
              choseDynamicPeriod(content) &&
              !previewUsesDateParameters(event)
            ) {
              setItems((current) => current.map((item) =>
                item.kind === "query_preview" && item.testRunId === event.testRunId
                  ? { ...item, stale: true, staleReason: "dynamic_period_mismatch" as const }
                  : item,
              ));
            }
          },
        );
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
        return (
          generation === generationRef.current && receivedDone && !receivedError
        );
      } catch (reason) {
        if (generation !== generationRef.current) return false;
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
              message: reason instanceof TypeError && /fetch|network|load failed/i.test(reason.message)
                ? `A conexão com o servidor foi interrompida.${activeRequestIdRef.current ? ` ID ${activeRequestIdRef.current.slice(0, 8)}.` : ""} Tente novamente.`
                : `${reason instanceof Error ? reason.message : "A conexão com a IA falhou."}${activeRequestIdRef.current ? ` (ID ${activeRequestIdRef.current.slice(0, 8)})` : ""}`,
            },
          ]);
        }
        return false;
      } finally {
        if (generation === generationRef.current) {
          setBusy(false);
          setActivityProgress(undefined);
          abortRef.current = null;
          activeRequestIdRef.current = null;
          activeAssistantIdRef.current = null;
        }
      }
    },
    [busy, draft, handleEvent, items, pathname, updateAssistant, setItems, setDraft, setBusy, setActivityProgress],
  );

  const retry = useCallback(
    () =>
      void send({
        content: lastPromptRef.current,
        retry: true,
        silentUser: lastSilentUserRef.current,
        continuation: lastContinuationRef.current,
        pageContext: lastPageContextRef.current,
      }),
    [send],
  );

  const submitQuestionnaire = useCallback(
    (item: QuestionnaireChatItem, answers: QuestionnaireAnswers) => {
      if (busy || item.answersSent) return;
      const answerText = [
        `Respostas ao formulário "${item.questionnaire.title}":`,
        ...item.questionnaire.questions.map((question) => {
          const values = answers[question.name] ?? [];
          return `- ${question.prompt}: ${values.length ? values.join(", ") : "Sem resposta"}`;
        }),
      ].join("\n");
      if (answerText.length > MAX_MESSAGE_CHARACTERS) {
        toast.error(
          "As respostas ficaram muito longas. Reduza o texto ou selecione menos opções e tente novamente.",
        );
        return;
      }
      void send({ content: answerText }).then((sent) => {
        if (!sent) return;
        setItems((current) =>
          current.map((candidate) =>
            candidate.kind === "questionnaire" && candidate.id === item.id
              ? { ...candidate, answers, answersSent: true }
              : candidate,
          ),
        );
      });
    },
    [busy, send, setItems],
  );

  const clear = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setActivityProgress(undefined);
    activeRequestIdRef.current = null;
    setItems([]);
    setDraft("");
    threadIdRef.current = crypto.randomUUID();
    activeAssistantIdRef.current = null;
    lastPromptRef.current = "";
    lastContinuationRef.current = undefined;
    lastPageContextRef.current = undefined;
    lastSilentUserRef.current = false;
    refreshedToolCallsRef.current.clear();
  }, []);

  const continueAfterQuerySaved = useCallback(
    (preview: QueryPreviewItem, queryId: string, queryName: string) => {
      const shouldContinue = preview.purpose === "dashboard"
        || hasPendingDashboardComponentRequest(items, pathname);
      const savedPreview = shouldContinue && preview.purpose !== "dashboard"
        ? { ...preview, purpose: "dashboard" as const }
        : preview;
      setItems((current) => markQueryPreviewSavedOnce(
        current,
        preview.testRunId,
        queryId,
        queryName,
        {
            ...savedPreview,
            id: newId(),
            savedQueryId: queryId,
            savedQueryName: queryName,
            stale: false,
        },
      ));
      if (!shouldContinue) return;
      void send({
        content: `A query “${queryName}” foi salva com o UUID ${queryId}. Continue a solicitação original que dependia dela; se não houver outra etapa pendente, confirme que ela foi salva.`,
        silentUser: true,
        continuation: { type: "query_saved", queryId, queryName },
        savedQueryContext: { id: queryId, name: queryName },
      }).then((continued) => {
        if (continued) return;
        setItems((current) => [
          ...current,
          {
            id: newId(),
            kind: "message",
            role: "assistant",
            content: `A query “${queryName}” foi salva com o UUID ${queryId}, mas a IA não concluiu a etapa seguinte. A query continua salva; você pode pedir para continuar usando-a no dashboard.`,
            status: "complete",
          },
        ]);
      });
    },
    [items, pathname, send, setItems],
  );

  return { send, retry, stop, clear, submitQuestionnaire, continueAfterQuerySaved };
}
