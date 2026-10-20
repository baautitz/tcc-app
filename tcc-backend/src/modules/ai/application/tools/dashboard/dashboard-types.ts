import type { AiDashboardQueryPreview } from "../../../../dashboards/domain/dashboard-preview-validation.js";
import type { DashboardDocument } from "../../../../dashboards/domain/dashboards.js";

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

export type { AiDashboardQueryPreview };

export interface AiDashboardToolsRepository {
  listSavedQueries(): Promise<AiDashboardQuery[]>;
  findSavedQueries(ids: string[]): Promise<AiDashboardQueryDefinition[]>;
  findDashboard(
    id: string,
  ): Promise<{ document: DashboardDocument; fingerprint: string } | undefined>;
  runPreview(
    query: AiDashboardQueryDefinition,
    values: Record<string, string | string[]>,
  ): Promise<AiDashboardQueryPreview>;
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
