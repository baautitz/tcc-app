import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "../db/client.js";
import { aiContextProposals, dataSourceTables, dataSources } from "../db/schema.js";
import type { AiContextProposal, AiContextProposalRepository, ContextProposalTarget, ContextProposalTargetType } from "../services/ai-context-proposals.js";

export function createAiContextProposalRepository(now: () => number = Date.now): AiContextProposalRepository {
  const mapProposal = (row: typeof aiContextProposals.$inferSelect | undefined) => row as AiContextProposal | undefined;
  const readTarget = async (input: { targetType: ContextProposalTargetType; dataSourceId: string; tableId?: string }): Promise<ContextProposalTarget | undefined> => {
    const source = (await db.select({
      id: dataSources.id,
      name: dataSources.name,
      context: dataSources.context,
      contextVersion: dataSources.contextVersion,
    }).from(dataSources).where(eq(dataSources.id, input.dataSourceId)).limit(1))[0];
    if (!source) return undefined;
    if (input.targetType === "source") return {
      targetType: "source", dataSourceId: source.id, sourceName: source.name,
      tableId: null, schemaName: null, tableName: null,
      contextVersion: source.contextVersion, context: source.context,
    };
    if (!input.tableId) return undefined;
    const table = (await db.select({
      id: dataSourceTables.id,
      schemaName: dataSourceTables.schemaName,
      tableName: dataSourceTables.tableName,
      context: dataSourceTables.context,
      contextVersion: dataSourceTables.contextVersion,
    }).from(dataSourceTables).where(and(
      eq(dataSourceTables.dataSourceId, input.dataSourceId),
      eq(dataSourceTables.id, input.tableId),
    )).limit(1))[0];
    if (!table) return undefined;
    return {
      targetType: "table", dataSourceId: source.id, sourceName: source.name,
      tableId: table.id, schemaName: table.schemaName, tableName: table.tableName,
      contextVersion: table.contextVersion, context: table.context,
    };
  };
  return {
    readTarget,
    async createProposal(input) {
      const row = (await db.insert(aiContextProposals).values(input).returning())[0];
      if (!row) throw new Error("Não foi possível persistir a proposta de contexto.");
      return mapProposal(row)!;
    },
    async findProposal(proposalId) {
      return mapProposal((await db.select().from(aiContextProposals).where(eq(aiContextProposals.id, proposalId)).limit(1))[0]);
    },
    async listPending(actorId, now) {
      const rows = await db.select().from(aiContextProposals).where(and(
        eq(aiContextProposals.actorId, actorId),
        eq(aiContextProposals.status, "pending"),
        gt(aiContextProposals.expiresAt, now),
      )).orderBy(asc(aiContextProposals.createdAt)).limit(50);
      return rows.map((row) => mapProposal(row)!);
    },
    transaction(work) {
      return db.transaction((tx) => work({
        async lockProposal(proposalId, actorId) {
          return mapProposal((await tx.select().from(aiContextProposals).where(and(
            eq(aiContextProposals.id, proposalId),
            eq(aiContextProposals.actorId, actorId),
          )).for("update").limit(1))[0]);
        },
        async lockTarget(proposal) {
          const source = (await tx.select({
            id: dataSources.id,
            name: dataSources.name,
            context: dataSources.context,
            contextVersion: dataSources.contextVersion,
          }).from(dataSources).where(eq(dataSources.id, proposal.dataSourceId)).for("update").limit(1))[0];
          if (!source) return undefined;
          if (proposal.targetType === "source") return {
            targetType: "source", dataSourceId: source.id, sourceName: source.name,
            tableId: null, schemaName: null, tableName: null,
            contextVersion: source.contextVersion, context: source.context,
          };
          if (!proposal.tableId) return undefined;
          const table = (await tx.select({
            id: dataSourceTables.id,
            schemaName: dataSourceTables.schemaName,
            tableName: dataSourceTables.tableName,
            context: dataSourceTables.context,
            contextVersion: dataSourceTables.contextVersion,
          }).from(dataSourceTables).where(and(
            eq(dataSourceTables.dataSourceId, proposal.dataSourceId),
            eq(dataSourceTables.id, proposal.tableId),
          )).for("update").limit(1))[0];
          if (!table) return undefined;
          return {
            targetType: "table", dataSourceId: source.id, sourceName: source.name,
            tableId: table.id, schemaName: table.schemaName, tableName: table.tableName,
            contextVersion: table.contextVersion, context: table.context,
          };
        },
        async updateTargetContext(proposal, contextValue, nextVersion) {
          if (proposal.targetType === "source") {
            const source = (await tx.select({ updatedAt: dataSources.updatedAt }).from(dataSources)
              .where(eq(dataSources.id, proposal.dataSourceId)).limit(1))[0];
            if (!source) return;
            await tx.update(dataSources).set({
              context: contextValue,
              contextVersion: nextVersion,
              updatedAt: new Date(Math.max(now(), source.updatedAt.getTime() + 1)),
            }).where(eq(dataSources.id, proposal.dataSourceId));
            return;
          }
          if (!proposal.tableId) return;
          await tx.update(dataSourceTables).set({ context: contextValue, contextVersion: nextVersion })
            .where(and(eq(dataSourceTables.id, proposal.tableId), eq(dataSourceTables.dataSourceId, proposal.dataSourceId)));
        },
        async updateProposalStatus(proposalId, status, resolvedAt) {
          await tx.update(aiContextProposals).set({ status, resolvedAt }).where(eq(aiContextProposals.id, proposalId));
        },
      }));
    },
  };
}
