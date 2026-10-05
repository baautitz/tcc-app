import { latestUserAskedToAddDashboardComponent, type AiChatAgent } from "../../ai-agent.js";
import type { AiToolProgressEvent } from "../../ai-read-tools.js";
import { AiReasoningFilter } from "../../ai-reasoning-filter.js";
import { isMatchingQueryUpdatePreview, queryUpdateRequest, repeatsDashboardComponentRequest } from "../chat-intents.js";
import type { AiChatRequest } from "../chat-schemas.js";
import { structuredResponseFallback } from "./helpers.js";

/** Applies reasoning filtering and safety fallbacks to the buffered model text. */
export function buildVisibleChunks(
  parsedBody: AiChatRequest,
  pendingModelText: string[],
  latestStructuredEvent: AiToolProgressEvent | undefined,
): string[] {
      const reasoningFilter = new AiReasoningFilter();
      const visibleChunks = pendingModelText
        .map((chunk) => reasoningFilter.push(chunk))
        .filter(Boolean);
      const remainingText = reasoningFilter.finish();
      if (remainingText) visibleChunks.push(remainingText);
      const pendingDashboardQuery = parsedBody.pendingQueryPreviews
        ?.filter((preview) => preview.purpose === "dashboard")
        .at(-1);
      const repeatedUnapprovedDashboardRequest =
        pendingDashboardQuery &&
        repeatsDashboardComponentRequest(
          parsedBody.messages,
          parsedBody.pageContext,
        ) &&
        latestStructuredEvent?.type !== "dashboard_preview" &&
        latestStructuredEvent?.type !== "dashboard_applied";
      if (repeatedUnapprovedDashboardRequest) {
        const safeResponse =
          latestStructuredEvent &&
          ["query_preview", "questionnaire", "context_proposal"].includes(
            latestStructuredEvent.type,
          )
            ? structuredResponseFallback(latestStructuredEvent)
            : `A query “${pendingDashboardQuery.queryName}” ainda está aguardando sua confirmação no cartão. Clique em “Revisar query para dashboard” e depois em “Salvar e continuar”. Repetir o pedido não salva a query; depois da confirmação, vou gerar a prévia do dashboard. Nenhuma alteração no dashboard foi aplicada.`;
        if (safeResponse)
          visibleChunks.splice(0, visibleChunks.length, safeResponse);
      }
      const dashboardRequest = latestUserAskedToAddDashboardComponent(
        parsedBody.messages,
        {
          pathname: parsedBody.pageContext?.pathname,
          dashboardId: parsedBody.pageContext?.dashboardId,
          pendingDashboardContinuation:
            parsedBody.continuation?.type === "query_saved",
        },
      );
      const hasDashboardActionCard =
        latestStructuredEvent?.type === "dashboard_preview" ||
        latestStructuredEvent?.type === "dashboard_applied" ||
        latestStructuredEvent?.type === "context_proposal" ||
        latestStructuredEvent?.type === "questionnaire" ||
        (latestStructuredEvent?.type === "query_preview" &&
          latestStructuredEvent.purpose === "dashboard");
      if (dashboardRequest && !hasDashboardActionCard) {
        visibleChunks.splice(
          0,
          visibleChunks.length,
          "O cartão de prévia do dashboard não foi gerado nesta rodada. Nenhuma alteração foi aplicada ao dashboard; a etapa de vinculação não foi concluída.",
        );
      }
      const latestUserRequest = parsedBody.messages.at(-1)?.content ?? "";
      const requestedQueryUpdate = queryUpdateRequest(latestUserRequest);
      const awaitingUserChoice =
        latestStructuredEvent?.type === "questionnaire";
      if (
        requestedQueryUpdate.requested &&
        !awaitingUserChoice &&
        !isMatchingQueryUpdatePreview(
          latestStructuredEvent,
          requestedQueryUpdate.queryName,
        )
      ) {
        visibleChunks.splice(
          0,
          visibleChunks.length,
          "Não consegui gerar a prévia de atualização da query nesta tentativa. Nenhuma alteração foi salva; a query não foi ajustada. As ferramentas de leitura ou validação não concluíram o fluxo necessário.",
        );
      }
  return visibleChunks;
}
