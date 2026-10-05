import { Hono } from "hono";
import { adminRequired, authentication, type AppVariables } from "../middleware/auth.js";
import { aiChat, approveProposal, dismissProposal, getContextProposalById, listContextProposals } from "../controllers/ai-admin.js";
import { commitProposal, previewProposal } from "../controllers/dashboards.js";

export const aiAdminRoutes = new Hono<{ Variables: AppVariables }>();
aiAdminRoutes.post("/api/admin/ai/chat", authentication, adminRequired, aiChat);
aiAdminRoutes.get("/api/admin/ai/context-proposals", authentication, adminRequired, listContextProposals);
aiAdminRoutes.get("/api/admin/ai/context-proposals/:proposalId", authentication, adminRequired, getContextProposalById);
aiAdminRoutes.post("/api/admin/ai/context-proposals/:proposalId/approve", authentication, adminRequired, approveProposal);
aiAdminRoutes.post("/api/admin/ai/context-proposals/:proposalId/dismiss", authentication, adminRequired, dismissProposal);
aiAdminRoutes.post("/api/admin/ai/dashboard-proposals/:id/preview", authentication, adminRequired, previewProposal);
aiAdminRoutes.post("/api/admin/ai/dashboard-proposals/:id/commit", authentication, adminRequired, commitProposal);
