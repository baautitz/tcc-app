import { z } from "zod";
import { AiChatService } from "../application/chat/ai-chat.js";
import { aiChatToolsFactory } from "../../../container.js";
import { contextProposalService } from "../application/context-proposals.js";
import { throwApiError } from "../../../shared/lib/domain-error.js";
import type { AppContext } from "../../../shared/middleware/auth.js";

const aiChatService = new AiChatService({
  createTools: (options) => aiChatToolsFactory.create(options),
});

export const aiChat = (context: AppContext) => aiChatService.handle(context);

const proposalIdParam = (context: AppContext) =>
  z.string().uuid().parse(context.req.param("proposalId"));

export async function listContextProposals(context: AppContext) {
  return context.json(
    await contextProposalService.listPending(context.get("currentUser").id),
  );
}

export async function getContextProposalById(context: AppContext) {
  const proposalId = proposalIdParam(context);
  try {
    return context.json(
      await contextProposalService.get(
        proposalId,
        context.get("currentUser").id,
      ),
    );
  } catch (error) {
    return throwApiError(error);
  }
}

export async function approveProposal(context: AppContext) {
  const proposalId = proposalIdParam(context);
  try {
    return context.json(
      await contextProposalService.approve(
        proposalId,
        context.get("currentUser").id,
      ),
    );
  } catch (error) {
    return throwApiError(error);
  }
}

export async function dismissProposal(context: AppContext) {
  const proposalId = proposalIdParam(context);
  try {
    return context.json(
      await contextProposalService.dismiss(
        proposalId,
        context.get("currentUser").id,
      ),
    );
  } catch (error) {
    return throwApiError(error);
  }
}
