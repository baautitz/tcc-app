import { useCallback, useEffect, useRef } from "react";
import { ApiError } from "@/shared/api/client";
import { aiApi } from "@/modules/ai/api/ai.api";
import { dashboardsApi } from "@/modules/dashboards/api/dashboards.api";
import { PanelRightClose, Sparkles } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/shared/ui/button";
import { useCurrentViewRefresh } from "@/shared/context/CurrentViewRefreshContext";
import { useAuth } from "@/modules/identity/hooks/AuthContext";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { cn } from "@/shared/lib/utils";
import { toast } from "@/shared/ui/toast";
import type { AiContextProposal } from "@/modules/ai/model/types";
import {
  type DashboardPreviewItem,
  MIN_AI_CHAT_WIDTH,
  MAX_AI_CHAT_WIDTH,
  newId,
  mergePendingContextProposals,
} from "@/modules/ai/model/chat-items";
import { ChatWindow } from "@/modules/ai/components/ChatWindow";
import { useChatSession } from "@/modules/ai/hooks/useChatSession";
import { useChatResize } from "@/modules/ai/hooks/useChatResize";
import { useChatSend } from "@/modules/ai/hooks/useChatSend";

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
  const { user } = useAuth();
  const refreshCurrentView = useCurrentViewRefresh();
  const session = useChatSession();
  const { items, setItems, draft, setDraft, busy, activityProgress } = session;
  const resize = useChatResize();
  const { panelWidth } = resize;
  const {
    send,
    retry,
    stop,
    clear,
    submitQuestionnaire,
    continueAfterQuerySaved,
    approveComponent,
    adjustComponent,
  } = useChatSend(session, location.pathname);
  const dashboardSavePendingRef = useRef(new Set<string>());

  useEffect(() => {
    if (!open || !user?.isAdmin) return;
    let active = true;
    aiApi
      .pendingAiContextProposals()
      .then((proposals) => {
        if (!active) return;
        setItems((current) => mergePendingContextProposals(current, proposals));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [open, user?.id, user?.isAdmin, setItems]);

  const markContextProposalResolved = useCallback(
    (proposalId: string, status: AiContextProposal["status"]) => {
      setItems((current) =>
        current.map((item) =>
          item.kind === "context_proposal" && item.id === proposalId
            ? {
                ...item,
                proposal: {
                  ...item.proposal,
                  status,
                  resolvedAt: new Date().toISOString(),
                },
              }
            : item,
        ),
      );
    },
    [setItems],
  );

  const handleDashboardSaved = useCallback(
    (dashboardId: string, mode: "create" | "update") => {
      const routeDashboardId = /^\/dashboards\/([^/]+)$/.exec(
        location.pathname,
      )?.[1];
      if (
        mode === "create" ||
        routeDashboardId?.toLowerCase() !== dashboardId.toLowerCase()
      ) {
        navigate(`/dashboards/${dashboardId}`);
        return;
      }
      refreshCurrentView();
    },
    [location.pathname, navigate, refreshCurrentView],
  );

  const applyDashboard = useCallback(
    async (item: DashboardPreviewItem, acknowledgeTruncation: boolean) => {
      if (
        item.saved ||
        item.stale ||
        dashboardSavePendingRef.current.has(item.proposalId)
      )
        return;
      if (new Date(item.expiresAt).getTime() <= Date.now()) {
        setItems((current) =>
          current.map((candidate) =>
            candidate.kind === "dashboard_preview" && candidate.id === item.id
              ? { ...candidate, stale: true }
              : candidate,
          ),
        );
        toast.error("A proposta expirou. Peça uma nova prévia ao assistente.");
        return;
      }
      dashboardSavePendingRef.current.add(item.proposalId);
      setItems((current) =>
        current.map((candidate) =>
          candidate.kind === "dashboard_preview" && candidate.id === item.id
            ? { ...candidate, saving: true }
            : candidate,
        ),
      );
      try {
        const result = await dashboardsApi.commitAiDashboardProposal(
          item.proposalId,
          acknowledgeTruncation,
        );
        setItems((current) =>
          current.map((candidate) =>
            candidate.kind === "dashboard_preview" && candidate.id === item.id
              ? { ...candidate, saved: true, saving: false }
              : candidate,
          ),
        );
        toast.success(
          result.alreadyApplied
            ? "A aplicação da proposta foi confirmada."
            : result.mode === "create"
              ? "Dashboard criado."
              : "Alterações aplicadas ao dashboard.",
        );
        handleDashboardSaved(result.id, result.mode);
        setItems((current) => [
          ...current,
          {
            id: newId(),
            kind: "message",
            role: "assistant",
            content: `Dashboard “${item.document.name}” salvo com o UUID ${result.id}.`,
            status: "complete",
          },
        ]);
      } catch (reason) {
        const conflict = reason instanceof ApiError && reason.status === 409;
        setItems((current) =>
          current.map((candidate) =>
            candidate.kind === "dashboard_preview" && candidate.id === item.id
              ? { ...candidate, stale: conflict, saving: false }
              : candidate,
          ),
        );
        toast.error(
          reason instanceof Error
            ? reason.message
            : "Não foi possível aplicar a proposta.",
        );
      } finally {
        dashboardSavePendingRef.current.delete(item.proposalId);
        setItems((current) =>
          current.map((candidate) =>
            candidate.kind === "dashboard_preview" && candidate.id === item.id
              ? { ...candidate, saving: false }
              : candidate,
          ),
        );
      }
    },
    [handleDashboardSaved, setItems],
  );

  const pageLabel = location.pathname.startsWith("/dashboards/")
    ? "Dashboard atual"
    : location.pathname.startsWith("/admin/sources")
      ? "Servidores e tabelas"
      : location.pathname.startsWith("/admin/queries")
        ? "Consultas"
        : "Plataforma de dashboards";

  const chatContent = (
    <ChatWindow
      items={items}
      busy={busy}
      activityProgress={activityProgress}
      draft={draft}
      pageLabel={pageLabel}
      onDraftChange={setDraft}
      onSend={() => void send()}
      onRetry={retry}
      onStop={stop}
      onClear={clear}
      onClose={() => onOpenChange(false)}
      onPreviewSaved={continueAfterQuerySaved}
      onContextProposalResolved={markContextProposalResolved}
      onApplyDashboard={applyDashboard}
      onSubmitQuestionnaire={submitQuestionnaire}
      onApproveComponent={approveComponent}
      onAdjustComponent={adjustComponent}
    />
  );

  return (
    <aside
      id="ai-chat-panel"
      aria-label="Chat com IA"
      aria-hidden={!open}
      className={cn(
        "relative flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-l bg-background",
        isMobile ? "w-full flex-1" : "max-w-[min(90vw,680px)]",
        !open && "hidden",
      )}
      style={{ width: isMobile ? "100%" : `${panelWidth}px` }}
    >
      {!isMobile && (
        <div
          role="separator"
          aria-label="Redimensionar painel do chat"
          aria-orientation="vertical"
          aria-valuemin={MIN_AI_CHAT_WIDTH}
          aria-valuemax={MAX_AI_CHAT_WIDTH}
          aria-valuenow={panelWidth}
          tabIndex={open ? 0 : -1}
          className="absolute inset-y-0 left-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none outline-none transition-colors hover:bg-primary/10 focus-visible:bg-primary/10"
          onPointerDown={resize.begin}
          onPointerMove={resize.move}
          onPointerUp={resize.end}
          onPointerCancel={resize.end}
          onKeyDown={resize.onKeyDown}
        />
      )}
      {chatContent}
    </aside>
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
