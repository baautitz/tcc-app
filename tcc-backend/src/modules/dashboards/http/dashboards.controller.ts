

import { z } from "zod";
import { } from "../../../shared/config/config.js";
import { dashboardAccessRepository } from "../infrastructure/dashboard-access-repository.js";
import { savedQueriesRepository } from "../../queries/infrastructure/saved-queries-repository.js";
import {
  
  
  
  
  
  
  
  
  dashboardCreateSchema,
  dashboardDocumentSchema,
  
  
  
} from "../../../shared/lib/contracts.js";

import { getDashboardFileById, getRegisteredDashboardFiles, getRegisteredDashboards } from "../domain/dashboards.js";
import { buildDashboardDefinitionFromDocument, dashboardQueryReferences } from "../application/dashboard-sync.js";

import { dashboardDocumentFingerprint } from "../domain/dashboard-proposals.js";

import { ApiError } from "../../../shared/lib/domain-error.js";

import type { AppContext } from "../../../shared/middleware/auth.js";
import { jsonBody } from "../../../shared/middleware/json-body.js";
import { assertDashboardAccess, getAccessibleDashboards } from "../application/dashboard-visibility.js";

import { syncDashboardDirectoryLocked, createDashboard, saveDashboardDocument } from "../application/dashboard-admin.js";
import { previewDashboardProposal, commitDashboardProposal } from "../application/dashboard-proposal-commit.js";

export async function syncDashboards(context: AppContext) {
  return context.json(await syncDashboardDirectoryLocked());
}

export async function createAdminDashboard(context: AppContext) {
  const input = await jsonBody(context, dashboardCreateSchema);
  const dashboard = await createDashboard(input);
  return context.json({ id: dashboard.id }, 201);
}

export async function previewProposal(context: AppContext) {
  const currentUser = context.get("currentUser");
  const receiptId = z.string().uuid().parse(context.req.param("id"));
  const input = await jsonBody(context, z.object({
    contextValues: z.record(
      z.string().max(80),
      z.union([z.string().max(2_048), z.array(z.string().max(2_048)).max(50)]),
    ).default({}),
    componentIds: z.array(z.string().trim().min(1).max(160)).max(24),
  }).strict());
  return context.json(await previewDashboardProposal(currentUser, receiptId, input));
}

export async function commitProposal(context: AppContext) {
  const currentUser = context.get("currentUser");
  const receiptId = z.string().uuid().parse(context.req.param("id"));
  const confirmation = await jsonBody(context, z.object({
    acknowledgeTruncation: z.boolean().default(false),
  }).strict());
  const committed = await commitDashboardProposal(currentUser, receiptId, confirmation);
  return context.json(committed, committed.mode === "create" && !committed.alreadyApplied ? 201 : 200);
}

export async function getAdminDashboard(context: AppContext) {
  const dashboardId = z.string().uuid().parse(context.req.param("id")).toLowerCase();
  const entry = (await getRegisteredDashboardFiles()).find((item) => item.dashboard.id === dashboardId);
  if (!entry) throw new ApiError(404, "Dashboard não encontrado.");
  return context.json({ document: entry.dashboard, revision: dashboardDocumentFingerprint(entry.dashboard) });
}

export async function updateAdminDashboard(context: AppContext) {
  const dashboardId = z.string().uuid().parse(context.req.param("id")).toLowerCase();
  const input = await jsonBody(context, z.object({
    document: dashboardDocumentSchema,
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict());
  if (input.document.id !== dashboardId) throw new ApiError(400, "O id do dashboard não pode ser alterado.");
  await saveDashboardDocument(dashboardId, input);
  return context.json({ id: dashboardId, saved: true, revision: dashboardDocumentFingerprint(input.document) });
}

export async function getDashboardUsers(context: AppContext) {
  const dashboardId = z.string().uuid().parse(context.req.param("id")).toLowerCase();
  const dashboard = await getDashboardFileById(dashboardId);
  if (!dashboard) throw new ApiError(404, "Dashboard não encontrado.");
  const assigned = await dashboardAccessRepository.listAssignedUserIds(dashboardId);
  const availableUsers = await dashboardAccessRepository.listAssignableUsers();
  return context.json({ users: availableUsers, userIds: assigned.map((assignment) => assignment.userId) });
}

export async function setDashboardUsers(context: AppContext) {
  const dashboardId = z.string().uuid().parse(context.req.param("id")).toLowerCase();
  const dashboard = await getDashboardFileById(dashboardId);
  if (!dashboard) throw new ApiError(404, "Dashboard não encontrado.");
  const input = await jsonBody(context, z.object({ userIds: z.array(z.string().uuid()) }).strict());
  const uniqueUserIds = [...new Set(input.userIds)];
  if (uniqueUserIds.length !== input.userIds.length) throw new ApiError(400, "Não repita usuários na lista de acesso do dashboard.");
  const knownUsers = await dashboardAccessRepository.findKnownUserIds(uniqueUserIds);
  if (knownUsers.length !== uniqueUserIds.length) throw new ApiError(400, "Um ou mais usuários selecionados não existem.");
  await dashboardAccessRepository.replaceUsers(dashboardId, uniqueUserIds);
  return context.json({ dashboardId, userIds: uniqueUserIds });
}

export async function listDashboards(context: AppContext) {
  await syncDashboardDirectoryLocked();
  const currentUser = context.get("currentUser");
  const accessibleDashboards = await getAccessibleDashboards(currentUser);
  return context.json(accessibleDashboards.map((dashboard) => ({
    id: dashboard.id,
    name: dashboard.name,
    description: dashboard.description ?? null,
  })));
}

export async function getDashboard(context: AppContext) {
  const dashboardId = z.string().uuid().parse(context.req.param("id")).toLowerCase();
  const dashboard = (await getRegisteredDashboards()).find((item) => item.id === dashboardId);
  if (!dashboard) throw new ApiError(404, "Dashboard não encontrado.");
  const currentUser = context.get("currentUser");
  await assertDashboardAccess(currentUser, dashboardId);
  const queryIds = [...dashboardQueryReferences(dashboard)];
  const catalogQueries = queryIds.length
    ? await savedQueriesRepository.listParametersByIds(queryIds)
    : [];
  let definition;
  try {
    definition = buildDashboardDefinitionFromDocument(dashboard, catalogQueries, { validateCatalog: false });
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : "O dashboard possui referências inválidas.");
  }
  return context.json({
    id: dashboard.id,
    name: dashboard.name,
    description: dashboard.description ?? null,
    definition,
  });
}
