import { lazy, Suspense } from "react";
import {
  Check,
  CircleAlert,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Wrench,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Message,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/shared/ui/message";
import { Bubble, BubbleContent } from "@/shared/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/shared/ui/marker";
import { cn } from "@/shared/lib/utils";
import type { AiContextProposal } from "@/modules/ai/model/types";
import {
  QuestionnaireCard,
  type QuestionnaireAnswers,
  type QuestionnaireChatItem,
} from "@/modules/ai/components/QuestionnaireCard";

import {
  type QueryPreviewItem,
  type DashboardPreviewItem,
  type ComponentPreviewItem,
  type ComponentAdjustment,
  type ChatItem,
  toolLabel,
  isExpired,
} from "@/modules/ai/model/chat-items";
import { ComponentPreviewCard } from "@/modules/ai/components/ComponentPreviewCard";
import { DashboardPreviewCard } from "@/modules/ai/components/DashboardPreviewCard";
const ChatMarkdown = lazy(() =>
  import("@/modules/ai/components/ChatMarkdown").then((module) => ({
    default: module.ChatMarkdown,
  })),
);
export function ChatItemView({
  item,
  busy,
  isLatestInteraction,
  onRetry,
  onReviewPreview,
  onApplyDashboard,
  onReviewContext,
  onSubmitQuestionnaire,
  onApproveComponent,
  onAdjustComponent,
  onOpenDashboardPicker,
}: {
  item: ChatItem;
  busy: boolean;
  isLatestInteraction: boolean;
  onRetry: () => void;
  onReviewPreview: (item: QueryPreviewItem) => void;
  onApplyDashboard: (
    item: DashboardPreviewItem,
    acknowledgeTruncation: boolean,
  ) => void;
  onReviewContext: (proposal: AiContextProposal) => void;
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
  if (item.kind === "dashboard_required") {
    return (
      <section className="mx-3 flex min-w-0 flex-col gap-2 border border-primary/30 bg-primary/5 p-3 text-sm sm:mx-4">
        <p className="font-medium">Escolha o dashboard</p>
        <p className="text-xs text-muted-foreground">
          Para gerar um componente, a conversa precisa de um dashboard ativo.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="w-full sm:w-fit"
          disabled={busy}
          onClick={onOpenDashboardPicker}
        >
          Selecionar dashboard
        </Button>
      </section>
    );
  }

  if (item.kind === "component_preview") {
    return (
      <ComponentPreviewCard
        item={item}
        busy={busy}
        isLatestInteraction={isLatestInteraction}
        onApprove={onApproveComponent}
        onAdjust={onAdjustComponent}
      />
    );
  }

  if (item.kind === "questionnaire") {
    return (
      <QuestionnaireCard
        item={item}
        busy={busy}
        isLatestInteraction={isLatestInteraction}
        onSubmit={onSubmitQuestionnaire}
      />
    );
  }

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
    const dashboardPurpose = item.purpose === "dashboard";
    return (
      <section className="mx-3 flex min-w-0 flex-col gap-3 border border-primary/30 bg-primary/5 p-3 text-sm sm:mx-4">
        <div className="min-w-0">
          <p className="font-medium">
            {dashboardPurpose ? "Query para dashboard" : "Consulta rápida"} ·{" "}
            {item.intent.mode === "update" ? "edição" : "nova query"}
          </p>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {item.dataSource.name} ·{" "}
            {item.savedQueryName ?? item.intent.queryName}
          </p>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {item.rowCount}/{item.rowLimit} linhas · {item.bytes}/
            {item.byteLimit} bytes
            {item.truncated
              ? ` · amostra truncada (${item.truncationReason})`
              : ""}
          </p>
          {!item.savedQueryId && !item.stale && isLatestInteraction && (
            <p className="mt-2 text-xs text-muted-foreground">
              {dashboardPurpose
                ? "Esta query é uma etapa da proposta de dashboard. Ao salvá-la, o assistente continuará essa tarefa."
                : "Esta consulta é pontual. Salvá-la adiciona a query ao catálogo sem iniciar outra tarefa automaticamente."}
            </p>
          )}
        </div>
        {item.savedQueryId ? (
          <div className="min-w-0 border-t border-primary/15 pt-2 text-xs">
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              Query salva
            </span>
            <code className="mt-1 block break-all rounded bg-background/70 px-2 py-1 text-muted-foreground">
              {item.savedQueryId}
            </code>
          </div>
        ) : item.stale ? (
          <p className="border-t border-primary/15 pt-2 text-xs text-muted-foreground">
            {item.staleReason === "dynamic_period_mismatch"
              ? "Esta prévia usa período fixo e não pode ser aprovada para acompanhar os filtros do dashboard. Aguarde uma nova prévia."
              : "Prévia substituída · teste novamente"}
          </p>
        ) : isLatestInteraction ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-fit"
            disabled={busy}
            onClick={() => onReviewPreview(item)}
          >
            {dashboardPurpose
              ? "Revisar query para dashboard"
              : "Revisar e salvar query"}
          </Button>
        ) : (
          <p className="border-t border-primary/15 pt-2 text-xs text-muted-foreground">
            Esta prévia pertence a uma mensagem anterior. Peça novamente para
            criar ou continuar a query.
          </p>
        )}
      </section>
    );
  }

  if (item.kind === "dashboard_preview") {
    return (
      <DashboardPreviewCard
        item={item}
        busy={busy}
        isLatestInteraction={isLatestInteraction}
        onApply={(acknowledgeTruncation) =>
          onApplyDashboard(item, acknowledgeTruncation)
        }
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

  if (item.kind === "context_proposal") {
    const target =
      item.proposal.targetType === "source"
        ? item.proposal.sourceName
        : `${item.proposal.sourceName} · ${item.proposal.schemaName}.${item.proposal.tableName}`;
    const pending =
      item.proposal.status === "pending" && !isExpired(item.proposal.expiresAt);
    const statusLabel = pending
      ? "Aguardando confirmação"
      : item.proposal.status === "approved"
        ? "Contexto aprovado"
        : item.proposal.status === "dismissed"
          ? "Proposta descartada"
          : item.proposal.status === "expired"
            ? "Proposta expirada"
            : "Proposta desatualizada";
    return (
      <div className="mx-4 border border-primary/30 bg-primary/5 p-3 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium">
              <Sparkles className="size-4 shrink-0 text-primary" />
              Proposta de contexto
            </p>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {target}
            </p>
          </div>
          {pending && (!item.ownerMessageId || isLatestInteraction) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onReviewContext(item.proposal)}
            >
              Revisar
            </Button>
          )}
        </div>
        <p className="mt-3 border-t border-primary/15 pt-2 text-xs text-muted-foreground">
          {statusLabel}. Nenhuma alteração foi aplicada até a aprovação
          explícita.
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
  if (!item.content.trim() && item.status === "complete" && !isUser)
    return null;
  const content = item.content;
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
            className={isUser ? undefined : "w-full max-w-full"}
          >
            <BubbleContent>
              {isUser ? (
                content
              ) : (
                <Suspense fallback={<span>{content}</span>}>
                  <ChatMarkdown content={content} />
                </Suspense>
              )}
            </BubbleContent>
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
