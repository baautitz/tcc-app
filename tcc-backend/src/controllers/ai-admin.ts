

import { z } from "zod";
import { } from "../config.js";

import { createAiChatHandler } from "../services/ai-chat.js";
import { createAiReadTools } from "../services/ai-read-tools.js";
import { createAiQueryTestTools } from "../services/ai-query-tools.js";
import { createAiQuestionnaireTools } from "../services/ai-questionnaire.js";

import { createAiDashboardTools } from "../services/ai-dashboard-tools.js";

import { throwApiError } from "../lib/domain-error.js";

import { createAiReadToolsRepository } from "../repositories/ai-read-tools.js";
import { createAiContextProposalRepository } from "../repositories/ai-context-proposals.js";

import { createAiDashboardToolsRepository } from "../repositories/ai-dashboard-tools.js";

import { approveContextProposal, createAiContextProposalTools, dismissContextProposal, getContextProposal, listPendingContextProposals } from "../services/ai-context-proposals.js";

import type { AppContext } from "../middleware/auth.js";

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
  return context.json(await listPendingContextProposals(createAiContextProposalRepository(), context.get("currentUser").id));
}

export async function getContextProposalById(context: AppContext) {
  const proposalId = z.string().uuid().parse(context.req.param("proposalId"));
  try {
    return context.json(await getContextProposal(createAiContextProposalRepository(), proposalId, context.get("currentUser").id));
  } catch (error) {
    return throwApiError(error);
  }
}

export async function approveProposal(context: AppContext) {
  const proposalId = z.string().uuid().parse(context.req.param("proposalId"));
  try {
    return context.json(await approveContextProposal(createAiContextProposalRepository(), proposalId, context.get("currentUser").id));
  } catch (error) {
    return throwApiError(error);
  }
}

export async function dismissProposal(context: AppContext) {
  const proposalId = z.string().uuid().parse(context.req.param("proposalId"));
  try {
    return context.json(await dismissContextProposal(createAiContextProposalRepository(), proposalId, context.get("currentUser").id));
  } catch (error) {
    return throwApiError(error);
  }
}
