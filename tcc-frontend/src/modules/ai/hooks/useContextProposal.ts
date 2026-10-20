import { useState } from "react";
import { ApiError } from "@/shared/api/client";
import { aiApi } from "@/modules/ai/api/ai.api";
import { useCurrentViewRefresh } from "@/shared/context/CurrentViewRefreshContext";
import { toast } from "@/shared/ui/toast";
import type { AiContextProposal } from "@/modules/ai/model/types";

export function useContextProposal(
  onContextProposalResolved: (
    proposalId: string,
    status: AiContextProposal["status"],
  ) => void,
) {
  const [reviewContext, setReviewContext] = useState<AiContextProposal>();
  const [resolvingContext, setResolvingContext] = useState(false);
  const refreshCurrentView = useCurrentViewRefresh();

  const resolveContextProposal = async (action: "approve" | "dismiss") => {
    if (
      !reviewContext ||
      resolvingContext ||
      reviewContext.status !== "pending"
    )
      return;
    setResolvingContext(true);
    try {
      const result =
        action === "approve"
          ? await aiApi.approveAiContextProposal(reviewContext.id)
          : await aiApi.dismissAiContextProposal(reviewContext.id);
      onContextProposalResolved(result.id, result.status);
      setReviewContext(undefined);
      if (action === "approve") {
        refreshCurrentView();
        toast.success("Contexto aprovado e atualizado.");
      } else {
        toast.success("Proposta descartada sem alterar o contexto.");
      }
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        try {
          const latest = await aiApi.aiContextProposal(reviewContext.id);
          onContextProposalResolved(latest.id, latest.status);
          setReviewContext(latest);
        } catch {
          // Keep the comparison available so the administrator can close it.
        }
      }
      toast.error(
        reason instanceof Error
          ? reason.message
          : "Não foi possível resolver a proposta.",
      );
    } finally {
      setResolvingContext(false);
    }
  };

  return {
    reviewContext,
    setReviewContext,
    resolvingContext,
    resolveContextProposal,
  };
}
