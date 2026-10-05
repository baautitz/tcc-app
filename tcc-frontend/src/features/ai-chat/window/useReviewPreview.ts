import { useEffect, useState } from "react";
import { useSaveQuery } from "@/features/queries/useSaveQuery";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/shared/ui/toast";
import type { ChatItem, ChatMessage, QueryPreviewItem } from "../chat-items";

export function useReviewPreview(
  items: ChatItem[],
  latestMessage: ChatMessage | undefined,
  onPreviewSaved: (
    item: QueryPreviewItem,
    queryId: string,
    queryName: string,
  ) => void,
) {
  const [reviewPreview, setReviewPreview] = useState<QueryPreviewItem>();
  const [reviewName, setReviewName] = useState("");
  const [stalePreview, setStalePreview] = useState(false);
  const [reloadedQuery, setReloadedQuery] = useState<{
    name: string;
    sqlText: string;
  }>();
  const { pendingRef: savePendingRef, saving: savingPreview, run: runSave, persist, reloadOnConflict, isConflict } = useSaveQuery();
  const { hasPermission } = useAuth();

  useEffect(() => {
    setReviewName(reviewPreview?.intent.queryName ?? "");
    setStalePreview(false);
    setReloadedQuery(undefined);
  }, [reviewPreview?.id]);

  useEffect(() => {
    if (
      reviewPreview &&
      items.some(
        (item) =>
          item.kind === "query_preview" &&
          item.testRunId === reviewPreview.testRunId &&
          item.stale,
      )
    ) {
      setStalePreview(true);
    }
  }, [items, reviewPreview]);

  useEffect(() => {
    if (!reviewPreview) return;
    const owner = items.find(
      (item): item is ChatMessage =>
        item.kind === "message" &&
        item.id === reviewPreview.ownerMessageId,
    );
    if (
      !owner ||
      owner.id !== latestMessage?.id ||
      owner.actionCard?.id !== reviewPreview.id
    ) {
      setReviewPreview(undefined);
    }
  }, [items, latestMessage?.id, reviewPreview]);

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
    await runSave(async () => {
    try {
      const body = {
        dataSourceId: reviewPreview.dataSource.id,
        name: reviewName.trim(),
        sqlText: reviewPreview.sqlText,
        parameters: reviewPreview.parameters,
        testRunId: reviewPreview.testRunId,
      };
      const saved = await persist(
        reviewPreview.intent.mode === "update" ? reviewPreview.intent.queryId! : undefined,
        body,
        reviewPreview.intent.queryUpdatedAt!,
      );
      onPreviewSaved(reviewPreview, saved.id, saved.name);
      window.dispatchEvent(new Event("queries:saved"));
      toast.success(
        reviewPreview.intent.mode === "update"
          ? "Edição da query aplicada."
          : "Nova query salva.",
      );
      setReviewPreview(undefined);
    } catch (reason) {
      setStalePreview(true);
      if (
        isConflict(reason) &&
        reviewPreview.intent.queryId
      ) {
        const latest = await reloadOnConflict(reviewPreview.intent.queryId);
        setReloadedQuery(latest && { name: latest.name, sqlText: latest.sqlText });
        toast.error(
          "A query mudou depois do teste. Recarreguei a versão atual; peça ao assistente para testar novamente.",
        );
      } else {
        toast.error(
          reason instanceof Error
            ? reason.message
            : "Não foi possível salvar a query. Gere uma nova prévia.",
        );
      }
    }
    });
  };

  return {
    reviewPreview,
    setReviewPreview,
    reviewName,
    setReviewName,
    stalePreview,
    reloadedQuery,
    savingPreview,
    canSavePreview,
    savePreview,
  };
}
