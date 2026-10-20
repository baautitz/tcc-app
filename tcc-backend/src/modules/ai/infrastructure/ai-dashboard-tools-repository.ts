import { externalSource } from "../../data-sources/application/external-source.js";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../shared/db/client.js";
import {
  dashboardProposalReceipts,
  dataSources,
  savedQueries,
} from "../../../shared/db/schema.js";
import {
  AI_QUERY_MAX_BYTES,
  AI_QUERY_MAX_ROWS,
  type ExternalPostgresConfig,
} from "../../data-sources/domain/external-source.js";
import { dashboardRegistry } from "../../dashboards/application/dashboard-registry.js";
import { querySourceTargetHash } from "../../queries/domain/query-lifecycle.js";
import { dashboardDocumentFingerprint } from "../../dashboards/domain/dashboard-proposals.js";
import {
  assertParameterDefinitions,
  assertSqlParameters,
  bindQueryParameters,
} from "../../../shared/security/query-security.js";
import type {
  AiDashboardQuery,
  AiDashboardQueryDefinition,
  AiDashboardToolsRepository,
} from "../application/tools/ai-dashboard-tools.js";
import { parameterDefinitionSchema } from "../../../shared/lib/contracts.js";

export class DrizzleAiDashboardToolsRepository implements AiDashboardToolsRepository {
  async listSavedQueries(): Promise<AiDashboardQuery[]> {
    const rows = await db
      .select({
        id: savedQueries.id,
        name: savedQueries.name,
        dataSourceId: savedQueries.dataSourceId,
        parameters: savedQueries.parameters,
        updatedAt: savedQueries.updatedAt,
        sourceUpdatedAt: dataSources.updatedAt,
        sourceHost: dataSources.host,
        sourcePort: dataSources.port,
        sourceDatabase: dataSources.databaseName,
        sourceUsername: dataSources.username,
        sourcePassword: dataSources.encryptedPassword,
      })
      .from(savedQueries)
      .innerJoin(dataSources, eq(savedQueries.dataSourceId, dataSources.id))
      .orderBy(asc(savedQueries.name))
      .limit(201);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      dataSourceId: row.dataSourceId,
      parameters: row.parameters,
      updatedAt: row.updatedAt,
      sourceUpdatedAt: row.sourceUpdatedAt,
      sourceTargetHash: querySourceTargetHash({
        id: row.dataSourceId,
        updatedAt: row.sourceUpdatedAt,
        host: row.sourceHost,
        port: row.sourcePort,
        databaseName: row.sourceDatabase,
        username: row.sourceUsername,
        encryptedPassword: row.sourcePassword,
      }),
    }));
  }

  async findSavedQueries(ids: string[]): Promise<AiDashboardQueryDefinition[]> {
    if (ids.length === 0) return [];
    const rows = await db
      .select({
        id: savedQueries.id,
        name: savedQueries.name,
        dataSourceId: savedQueries.dataSourceId,
        sqlText: savedQueries.sqlText,
        parameters: savedQueries.parameters,
        updatedAt: savedQueries.updatedAt,
        source: dataSources,
      })
      .from(savedQueries)
      .innerJoin(dataSources, eq(savedQueries.dataSourceId, dataSources.id))
      .where(inArray(savedQueries.id, ids));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      dataSourceId: row.dataSourceId,
      sqlText: row.sqlText,
      parameters: row.parameters,
      updatedAt: row.updatedAt,
      sourceUpdatedAt: row.source.updatedAt,
      sourceTargetHash: querySourceTargetHash(row.source),
      connection: externalSource().sourceConnection(row.source),
    }));
  }

  async findDashboard(id: string) {
    const match = (await dashboardRegistry.getRegisteredDashboardFiles()).find(
      (item) => item.dashboard.id === id.toLowerCase(),
    );
    return match
      ? {
          document: match.dashboard,
          fingerprint: dashboardDocumentFingerprint(match.dashboard),
        }
      : undefined;
  }

  async runPreview(
    query: AiDashboardQueryDefinition,
    values: Record<string, string | string[]>,
  ) {
    const parameters = z
      .array(parameterDefinitionSchema)
      .parse(query.parameters);
    assertParameterDefinitions(parameters);
    assertSqlParameters(query.sqlText, parameters);
    const bound = bindQueryParameters(query.sqlText, parameters, values);
    const result = await externalSource().runBoundedReadOnlyQueryWithRetry(
      query.connection as ExternalPostgresConfig,
      bound.sqlText,
      bound.values,
      {
        rowLimit: AI_QUERY_MAX_ROWS,
        byteLimit: AI_QUERY_MAX_BYTES,
        preserveConfiguredSearchPath: true,
        allowGeneralReadOnlySql: true,
      },
    );
    return result;
  }

  async issueReceipt(
    input: Parameters<AiDashboardToolsRepository["issueReceipt"]>[0],
  ) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM dashboard_proposal_receipts
          WHERE id IN (
            SELECT id FROM dashboard_proposal_receipts
            WHERE expires_at <= now()
              OR (consumed_at IS NOT NULL AND consumed_at < now() - interval '1 day')
            ORDER BY expires_at ASC
            LIMIT 200
          )`);
      await tx.insert(dashboardProposalReceipts).values(input);
    });
  }
}
