export type AiContextProposal = {
  id: string;
  actorId: string;
  targetType: "source" | "table";
  dataSourceId: string;
  tableId: string | null;
  sourceName: string;
  schemaName: string | null;
  tableName: string | null;
  baseContextVersion: number;
  currentContext: string;
  proposedContext: string;
  reason: string;
  status: "pending" | "approved" | "dismissed" | "stale" | "expired";
  expiresAt: string;
  createdAt: string;
  resolvedAt: string | null;
};
