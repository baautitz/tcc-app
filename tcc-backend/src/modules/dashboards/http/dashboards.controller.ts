import { z } from "zod";
import {
  dashboardCreateSchema,
  dashboardDocumentSchema,
} from "../../../shared/lib/contracts.js";
import { dashboardDocumentFingerprint } from "../domain/dashboard-proposals.js";
import { ApiError } from "../../../shared/lib/domain-error.js";
import type { AppContext } from "../../../shared/middleware/auth.js";
import { jsonBody } from "../../../shared/middleware/json-body.js";
import { dashboardAdminService } from "../application/dashboard-admin.js";
import {
  dashboardProposalService,
  dashboardVisibilityService,
} from "../../../container.js";

const dashboardIdParam = (context: AppContext) =>
  z.string().uuid().parse(context.req.param("id")).toLowerCase();

export async function syncDashboards(context: AppContext) {
  return context.json(
    await dashboardAdminService.syncDashboardDirectoryLocked(),
  );
}

export async function createAdminDashboard(context: AppContext) {
  const input = await jsonBody(context, dashboardCreateSchema);
  const dashboard = await dashboardAdminService.createDashboard(input);
  return context.json({ id: dashboard.id }, 201);
}

export async function previewProposal(context: AppContext) {
  const currentUser = context.get("currentUser");
  const receiptId = z.string().uuid().parse(context.req.param("id"));
  const input = await jsonBody(
    context,
    z
      .object({
        contextValues: z
          .record(
            z.string().max(80),
            z.union([
              z.string().max(2_048),
              z.array(z.string().max(2_048)).max(50),
            ]),
          )
          .default({}),
        componentIds: z.array(z.string().trim().min(1).max(160)).max(24),
      })
      .strict(),
  );
  return context.json(
    await dashboardProposalService.previewDashboardProposal(
      currentUser,
      receiptId,
      input,
    ),
  );
}

export async function commitProposal(context: AppContext) {
  const currentUser = context.get("currentUser");
  const receiptId = z.string().uuid().parse(context.req.param("id"));
  const confirmation = await jsonBody(
    context,
    z
      .object({
        acknowledgeTruncation: z.boolean().default(false),
      })
      .strict(),
  );
  const committed = await dashboardProposalService.commitDashboardProposal(
    currentUser,
    receiptId,
    confirmation,
  );
  return context.json(
    committed,
    committed.mode === "create" && !committed.alreadyApplied ? 201 : 200,
  );
}

export async function getAdminDashboard(context: AppContext) {
  return context.json(
    await dashboardAdminService.getAdminDashboard(dashboardIdParam(context)),
  );
}

export async function updateAdminDashboard(context: AppContext) {
  const dashboardId = z
    .string()
    .uuid()
    .parse(context.req.param("id"))
    .toLowerCase();
  const input = await jsonBody(
    context,
    z
      .object({
        document: dashboardDocumentSchema,
        expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  );
  if (input.document.id !== dashboardId)
    throw new ApiError(400, "O id do dashboard não pode ser alterado.");
  await dashboardAdminService.saveDashboardDocument(dashboardId, input);
  return context.json({
    id: dashboardId,
    saved: true,
    revision: dashboardDocumentFingerprint(input.document),
  });
}

export async function getDashboardUsers(context: AppContext) {
  return context.json(
    await dashboardAdminService.getDashboardUsers(dashboardIdParam(context)),
  );
}

export async function setDashboardUsers(context: AppContext) {
  return context.json(
    await dashboardAdminService.setDashboardUsers(
      dashboardIdParam(context),
      () =>
        jsonBody(
          context,
          z.object({ userIds: z.array(z.string().uuid()) }).strict(),
        ),
    ),
  );
}

export async function listDashboards(context: AppContext) {
  await dashboardAdminService.syncDashboardDirectoryLocked();
  return context.json(
    await dashboardVisibilityService.listDashboards(context.get("currentUser")),
  );
}

export async function getDashboard(context: AppContext) {
  return context.json(
    await dashboardVisibilityService.getDashboardView(
      context.get("currentUser"),
      dashboardIdParam(context),
    ),
  );
}
