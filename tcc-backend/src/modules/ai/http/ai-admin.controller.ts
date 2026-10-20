import { z } from "zod";
import {} from "../../../shared/config/config.js";

import { createAiChatHandler } from "../application/chat/ai-chat.js";
import { createAiReadTools } from "../application/tools/ai-read-tools.js";
import { createAiQueryTestTools } from "../application/tools/ai-query-tools.js";
import { createAiQuestionnaireTools } from "../application/ai-questionnaire.js";

import { createAiDashboardTools } from "../application/tools/ai-dashboard-tools.js";

import { throwApiError } from "../../../shared/lib/domain-error.js";

import { createAiReadToolsRepository } from "../infrastructure/ai-read-tools-repository.js";
import { createAiContextProposalRepository } from "../infrastructure/ai-context-proposals-repository.js";

import { createAiDashboardToolsRepository } from "../infrastructure/ai-dashboard-tools-repository.js";

import {
  approveContextProposal,
  createAiContextProposalTools,
  dismissContextProposal,
  getContextProposal,
  listPendingContextProposals,
} from "../domain/ai-context-proposals.js";

import type { AppContext } from "../../../shared/middleware/auth.js";

export const aiChat = createAiChatHandler({
  createTools: ({ currentUser, pageContext, onToolEvent }) => {
    const repository = createAiReadToolsRepository();
    return [
      ...createAiQuestionnaireTools({ currentUser, onQuestion: onToolEvent }),
      ...createAiReadTools({ currentUser, onToolEvent, repository }),
      ...createAiQueryTestTools({ currentUser, onToolEvent, repository }),
      ...createAiDashboardTools({
        currentUser,
        pageDashboardId: pageContext?.dashboardId,
        onToolEvent,
        repository: createAiDashboardToolsRepository(),
      }),
      ...createAiContextProposalTools({
        currentUser,
        repository: createAiContextProposalRepository(),
        onProposal: onToolEvent,
      }),
    ];
  },
});

export async function listContextProposals(context: AppContext) {
  return context.json(
    await listPendingContextProposals(
      createAiContextProposalRepository(),
      context.get("currentUser").id,
    ),
  );
}

export async function getContextProposalById(context: AppContext) {
  const proposalId = z.string().uuid().parse(context.req.param("proposalId"));
  try {
    return context.json(
      await getContextProposal(
        createAiContextProposalRepository(),
        proposalId,
        context.get("currentUser").id,
      ),
    );
  } catch (error) {
    return throwApiError(error);
  }
}

export async function approveProposal(context: AppContext) {
  const proposalId = z.string().uuid().parse(context.req.param("proposalId"));
  try {
    return context.json(
      await approveContextProposal(
        createAiContextProposalRepository(),
        proposalId,
        context.get("currentUser").id,
      ),
    );
  } catch (error) {
    return throwApiError(error);
  }
}

export async function dismissProposal(context: AppContext) {
  const proposalId = z.string().uuid().parse(context.req.param("proposalId"));
  try {
    return context.json(
      await dismissContextProposal(
        createAiContextProposalRepository(),
        proposalId,
        context.get("currentUser").id,
      ),
    );
  } catch (error) {
    return throwApiError(error);
  }
}
