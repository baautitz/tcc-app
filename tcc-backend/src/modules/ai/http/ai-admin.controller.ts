import { z } from "zod";
import { AiChatService } from "../application/chat/ai-chat.js";
import {
  aiChatToolsFactory,
  aiDashboardToolsRepository,
} from "../../../container.js";
import { contextProposalService } from "../application/context-proposals.js";
import { throwApiError } from "../../../shared/lib/domain-error.js";
import { jsonBody } from "../../../shared/middleware/json-body.js";
import { AiComponentPreviewService } from "../application/component-preview.js";
import { filterValuesSchema } from "../application/tools/dashboard/component-values.js";
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

const componentValuesSchema = z
  .object({
    contextValues: filterValuesSchema.default({}),
    parameterValues: filterValuesSchema.default({}),
  })
  .strict();

const componentPreviewService = new AiComponentPreviewService(
  {
    findComponentReceipt: (id) =>
      aiDashboardToolsRepository.findComponentReceipt(id),
    findSavedQueries: (ids) => aiDashboardToolsRepository.findSavedQueries(ids),
    findDashboard: (id) => aiDashboardToolsRepository.findDashboard(id),
    runPreview: (query, values) =>
      aiDashboardToolsRepository.runPreview(query, values),
    approveComponentReceipt: (id, actorId, values, now) =>
      aiDashboardToolsRepository.approveComponentReceipt(
        id,
        actorId,
        values,
        now,
      ),
  },
  () => Date.now(),
);

const receiptIdParam = (context: AppContext) =>
  z.string().uuid().parse(context.req.param("receiptId"));

/** Repete a prévia do componente isolado com os valores do cartão, sem a IA. */
export async function previewComponentReceipt(context: AppContext) {
  const receiptId = receiptIdParam(context);
  const values = await jsonBody(context, componentValuesSchema);
  return context.json(
    await componentPreviewService.preview(
      context.get("currentUser").id,
      receiptId,
      values,
    ),
  );
}

/** Aprova o componente; o corpo (opcional) guarda os valores aplicados no cartão. */
export async function approveComponentReceipt(context: AppContext) {
  const receiptId = receiptIdParam(context);
  const hasBody = (await context.req.text()).trim().length > 0;
  const values = hasBody
    ? await jsonBody(context, componentValuesSchema)
    : undefined;
  await componentPreviewService.approve(
    context.get("currentUser").id,
    receiptId,
    values,
  );
  return context.json({ id: receiptId, approved: true });
}
