import type { AiDashboardQueryPreview } from "../../../../dashboards/domain/dashboard-preview-validation.js";
import type { AuthenticatedUser } from "../../../../identity/domain/auth-user.js";
import type { AiToolProgressEvent } from "../read/read-types.js";
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

export interface AiDashboardToolsOptions {
  currentUser: AuthenticatedUser;
  pageDashboardId?: string;
  repository: AiDashboardToolsRepository;
  onToolEvent?: (event: AiToolProgressEvent) => void | Promise<void>;
  /** Relógio injetável (padrão: Date.now). */
  now?: () => number;
}

/** Recibo de componente: prova a aprovação do componente isolado (fase 3). */
export interface AiComponentReceipt {
  id: string;
  actorId: string;
  component: unknown;
  expiresAt: Date;
  approvedAt: Date | null;
  consumedAt: Date | null;
  /** Dashboard ativo quando o cartão foi emitido (nulo em Recibos antigos). */
  dashboardId?: string | null;
  /** Ligação parâmetro da query -> filtro do dashboard. */
  parameterBindings?: Record<string, string> | null;
  /** Valores dos filtros do dashboard guardados ao aprovar. */
  contextValues?: Record<string, string | string[]> | null;
  /** Valores dos parâmetros sem filtro correspondente, guardados ao aprovar. */
  parameterValues?: Record<string, string | string[]> | null;
}

export interface AiDashboardToolsRepository {
  issueComponentReceipt(input: {
    id: string;
    actorId: string;
    component: unknown;
    expiresAt: Date;
    dashboardId?: string;
    parameterBindings?: Record<string, string>;
  }): Promise<void>;
  findComponentReceipt(id: string): Promise<AiComponentReceipt | undefined>;
  listSavedQueries(): Promise<AiDashboardQuery[]>;
  findSavedQueries(ids: string[]): Promise<AiDashboardQueryDefinition[]>;
  findDashboard(
    id: string,
  ): Promise<{ document: DashboardDocument; fingerprint: string } | undefined>;
  runPreview(
    query: AiDashboardQueryDefinition,
    values: Record<string, string | string[]>,
  ): Promise<AiDashboardQueryPreview>;
  issueReceipt(
    input: {
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
    },
    options?: {
      /** Uso único, na mesma transação: sem consumo válido nada é emitido. */
      consumeComponentReceipt?: { id: string; actorId: string; now: Date };
    },
  ): Promise<boolean>;
}
