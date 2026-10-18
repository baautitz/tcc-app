import type { z } from "zod";
import type { parameterDefinitionSchema } from "../../shared/lib/contracts.js";
import type { AuthenticatedUser } from "../../modules/identity/domain/auth-user.js";
import type { DiscoveredColumn, DiscoveredTable, ExternalPostgresConfig } from "../../modules/data-sources/infrastructure/external-pg/index.js";
import type { runBoundedReadOnlyQuery as defaultRunBoundedReadOnlyQuery } from "../../modules/data-sources/infrastructure/external-pg/index.js";
import type { ContextProposalProgressEvent } from "../ai-context-proposals.js";
import type { AiQuestionnaireProgressEvent } from "../ai-questionnaire.js";

export interface AiReadSource {
  id: string;
  name: string;
  databaseName: string;
  context: string;
  connection: ExternalPostgresConfig;
}

export interface AiReadSourceSummary {
  id: string;
  name: string;
}

export interface AiReadTableName {
  id: string;
  dataSourceId: string;
  schemaName: string;
  tableName: string;
}

export interface AiReadTable extends AiReadTableName {
  context: string;
}

export interface AiReadToolsRepository {
  listSources(offset: number, limit: number): Promise<{ sources: AiReadSourceSummary[]; total: number }>;
  findSource(dataSourceId: string): Promise<AiReadSource | undefined>;
  listCatalogTables(dataSourceId: string): Promise<AiReadTableName[]>;
  findCatalogTable(dataSourceId: string, tableId: string): Promise<AiReadTable | undefined>;
  listLiveBaseTables(connection: ExternalPostgresConfig): Promise<DiscoveredTable[]>;
  getLiveColumns(
    connection: ExternalPostgresConfig,
    schemaName: string,
    tableName: string,
  ): Promise<DiscoveredColumn[]>;
}

export type AiToolProgressEvent =
  | { type: "tool_start"; toolCallId: string; toolName: string }
  | { type: "tool_result"; toolCallId: string; toolName: string; ok: boolean }
  | {
      type: "query_preview";
      toolCallId: string;
      testRunId: string;
      dataSource: { id: string; name: string };
      purpose?: "dashboard" | "quick_query";
      intent: {
        mode: "create" | "update";
        queryId?: string;
        queryName: string;
        queryUpdatedAt?: string;
      };
      sqlText: string;
      parameters: z.infer<typeof parameterDefinitionSchema>[];
      testValues: Record<string, string | string[]>;
      rows: Record<string, unknown>[];
      rowCount: number;
      rowLimit: number;
      byteLimit: number;
      bytes: number;
      truncated: boolean;
      truncationReason: "row_limit" | "byte_limit" | null;
    }
  | {
      type: "dashboard_preview";
      toolCallId: string;
      proposalId: string;
      previewComponentIds: string[];
      expiresAt: string;
      canCommit: boolean;
      issues: string[];
      requiresTruncationAcknowledgement: boolean;
      mode: "create" | "update";
      dashboardId: string;
      expectedDashboardFingerprint: string | null;
      document: import("../dashboards.js").DashboardDocument;
      definition: import("../../shared/lib/contracts.js").DashboardDefinition;
      changeSummary: string[];
      componentChanges: Record<string, "added" | "modified" | "unchanged">;
      queries: Record<string, {
        rows: Record<string, unknown>[];
        rowLimit: number;
        byteLimit: number;
        bytes: number;
        truncated: boolean;
        truncationReason: "row_limit" | "byte_limit" | null;
        error?: string;
      }>;
    }
  | {
      type: "dashboard_applied";
      dashboardId: string;
      dashboardName: string;
      mode: "create" | "update";
    }
  | ContextProposalProgressEvent
  | AiQuestionnaireProgressEvent;

/** Porta de execução de consultas limitadas somente leitura. */
export type RunBoundedReadOnlyQuery = typeof defaultRunBoundedReadOnlyQuery;

export interface CreateAiReadToolsOptions {
  runBoundedReadOnlyQuery?: RunBoundedReadOnlyQuery;
  currentUser: AuthenticatedUser;
  repository: AiReadToolsRepository;
  onToolEvent?: (event: AiToolProgressEvent) => void | Promise<void>;
}
