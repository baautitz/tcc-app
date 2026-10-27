import { Bot, LoaderCircle, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/shared/ui/message-scroller";
import { Marker, MarkerContent, MarkerIcon } from "@/shared/ui/marker";
import type { AiContextProposal } from "@/modules/ai/model/types";
import {
  type QuestionnaireAnswers,
  type QuestionnaireChatItem,
} from "@/modules/ai/components/QuestionnaireCard";
import {
  type ChatMessage,
  type QueryPreviewItem,
  type DashboardPreviewItem,
  type ComponentPreviewItem,
  type ComponentAdjustment,
  type ChatItem,
  isActionCardItem,
} from "@/modules/ai/model/chat-items";
import { ChatItemView } from "@/modules/ai/components/ChatItemView";
import { ChatComposer } from "@/modules/ai/components/ChatComposer";
import { ReviewContextDialog } from "@/modules/ai/components/ReviewContextDialog";
import { ReviewPreviewDialog } from "@/modules/ai/components/ReviewPreviewDialog";
import { useContextProposal } from "@/modules/ai/hooks/useContextProposal";
import { useReviewPreview } from "@/modules/ai/hooks/useReviewPreview";

export function ChatWindow({
  items,
  busy,
  activityProgress,
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
  onContextProposalResolved,
  onSubmitQuestionnaire,
  onApproveComponent,
  onAdjustComponent,
  onOpenDashboardPicker,
}: {
  items: ChatItem[];
  busy: boolean;
  activityProgress?: string;
  draft: string;
  pageLabel: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onRetry: () => void;
  onStop: () => void;
  onClear: () => void;
  onClose: () => void;
  onPreviewSaved: (
    item: QueryPreviewItem,
    queryId: string,
    queryName: string,
  ) => void;
  onApplyDashboard: (
    item: DashboardPreviewItem,
    acknowledgeTruncation: boolean,
  ) => void;
  onContextProposalResolved: (
    proposalId: string,
    status: AiContextProposal["status"],
  ) => void;
  onSubmitQuestionnaire: (
    item: QuestionnaireChatItem,
    answers: QuestionnaireAnswers,
  ) => void;
  onApproveComponent: (item: ComponentPreviewItem) => void;
  onAdjustComponent: (
    item: ComponentPreviewItem,
    adjustment: ComponentAdjustment,
  ) => void;
  onOpenDashboardPicker: () => void;
}) {
  const latestMessage = [...items]
    .reverse()
    .find((item): item is ChatMessage => item.kind === "message");
  const isLatestInteractionItem = (item: ChatItem) => {
    if (item.kind === "message") return item.id === latestMessage?.id;
    if (!isActionCardItem(item) || !item.ownerMessageId) return false;
    const owner = items.find(
      (candidate): candidate is ChatMessage =>
        candidate.kind === "message" && candidate.id === item.ownerMessageId,
    );
    return Boolean(
      owner &&
      owner.id === latestMessage?.id &&
      owner.actionCard?.id === item.id &&
      owner.actionCard?.kind === item.kind,
    );
  };

  const {
    reviewPreview,
    setReviewPreview,
    reviewName,
    setReviewName,
    stalePreview,
    reloadedQuery,
    savingPreview,
    canSavePreview,
    savePreview,
  } = useReviewPreview(items, latestMessage, onPreviewSaved);
  const {
    reviewContext,
    setReviewContext,
    resolvingContext,
    resolveContextProposal,
  } = useContextProposal(onContextProposalResolved);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3 h-14">
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
                  {items.map((item) => {
                    if (
                      item.kind === "message" &&
                      item.role === "assistant" &&
                      !item.content.trim() &&
                      item.status !== "stopped"
                    ) {
                      return null;
                    }

                    return (
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
                          isLatestInteraction={isLatestInteractionItem(item)}
                          onRetry={onRetry}
                          onReviewPreview={setReviewPreview}
                          onApplyDashboard={onApplyDashboard}
                          onReviewContext={setReviewContext}
                          onSubmitQuestionnaire={onSubmitQuestionnaire}
                          onApproveComponent={onApproveComponent}
                          onAdjustComponent={onAdjustComponent}
                          onOpenDashboardPicker={onOpenDashboardPicker}
                        />
                      </MessageScrollerItem>
                    );
                  })}
                  {busy && activityProgress && (
                    <MessageScrollerItem messageId="assistant-thinking">
                      <Marker role="status" className="px-4 text-xs">
                        <MarkerIcon>
                          <LoaderCircle className="animate-spin" />
                        </MarkerIcon>
                        <MarkerContent className="shimmer">
                          {activityProgress}
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

      <ChatComposer
        busy={busy}
        draft={draft}
        onDraftChange={onDraftChange}
        onSend={onSend}
        onStop={onStop}
      />
      <ReviewPreviewDialog
        reviewPreview={reviewPreview}
        setReviewPreview={setReviewPreview}
        savingPreview={savingPreview}
        reviewName={reviewName}
        setReviewName={setReviewName}
        stalePreview={stalePreview}
        reloadedQuery={reloadedQuery}
        canSavePreview={canSavePreview}
        busy={busy}
        savePreview={savePreview}
      />
      <ReviewContextDialog
        reviewContext={reviewContext}
        setReviewContext={setReviewContext}
        resolvingContext={resolvingContext}
        resolveContextProposal={resolveContextProposal}
      />
    </div>
  );
}
