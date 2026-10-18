import type { DashboardDocument } from "../../modules/dashboards/domain/dashboards.js";

export interface AiDashboardQuery {
  id: string;
  name: string;
  dataSourceId: string;
  parameters: unknown;
  updatedAt: Date;
  sourceUpdatedAt: Date;
  sourceTargetHash: string;
}

export interface AiDashboardQueryDefinition extends AiDashboardQuery {
  sqlText: string;
  connection: unknown;
}

export interface AiDashboardQueryPreview {
  rows: Record<string, unknown>[];
  rowLimit: number;
  byteLimit: number;
  bytes: number;
  truncated: boolean;
  truncationReason: "row_limit" | "byte_limit" | null;
  error?: string;
  previewPending?: string;
}

export interface AiDashboardToolsRepository {
  listSavedQueries(): Promise<AiDashboardQuery[]>;
  findSavedQueries(ids: string[]): Promise<AiDashboardQueryDefinition[]>;
  findDashboard(id: string): Promise<{ document: DashboardDocument; fingerprint: string } | undefined>;
  runPreview(query: AiDashboardQueryDefinition, values: Record<string, string | string[]>): Promise<AiDashboardQueryPreview>;
  issueReceipt(input: {
    id: string;
    actorId: string;
    mode: "create" | "update";
    dashboardId: string;
    expectedDashboardFingerprint: string | null;
    document: DashboardDocument;
    documentFingerprint: string;
    referenceFingerprint: string;
    hasTruncatedPreview: boolean;
    expiresAt: Date;
  }): Promise<void>;
}
