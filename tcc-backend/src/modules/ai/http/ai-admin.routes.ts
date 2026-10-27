import { Hono } from "hono";
import {
  adminRequired,
  authentication,
  type AppVariables,
} from "../../../shared/middleware/auth.js";
import {
  aiChat,
  approveComponentReceipt,
  approveProposal,
  dismissProposal,
  getContextProposalById,
  listContextProposals,
  previewComponentReceipt,
} from "./ai-admin.controller.js";

export const aiAdminRoutes = new Hono<{ Variables: AppVariables }>();
aiAdminRoutes.post("/api/admin/ai/chat", authentication, adminRequired, aiChat);
aiAdminRoutes.get(
  "/api/admin/ai/context-proposals",
  authentication,
  adminRequired,
  listContextProposals,
);
aiAdminRoutes.get(
  "/api/admin/ai/context-proposals/:proposalId",
  authentication,
  adminRequired,
  getContextProposalById,
);
aiAdminRoutes.post(
  "/api/admin/ai/context-proposals/:proposalId/approve",
  authentication,
  adminRequired,
  approveProposal,
);
aiAdminRoutes.post(
  "/api/admin/ai/context-proposals/:proposalId/dismiss",
  authentication,
  adminRequired,
  dismissProposal,
);
aiAdminRoutes.post(
  "/api/admin/ai/component-receipts/:receiptId/approve",
  authentication,
  adminRequired,
  approveComponentReceipt,
);
aiAdminRoutes.post(
  "/api/admin/ai/component-receipts/:receiptId/preview",
  authentication,
  adminRequired,
  previewComponentReceipt,
);
