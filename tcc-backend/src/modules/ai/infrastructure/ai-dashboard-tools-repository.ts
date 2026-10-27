import type { ExternalSourcePort } from "../../data-sources/domain/external-source.js";
import { and, asc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../shared/db/client.js";
import {
  aiComponentReceipts,
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Limpa (até 200) recibos expirados ou consumidos há mais de um dia da tabela. */
async function deleteStaleReceipts(
  tx: Tx,
  table: typeof aiComponentReceipts | typeof dashboardProposalReceipts,
) {
  await tx.execute(sql`DELETE FROM ${table}
      WHERE id IN (
        SELECT id FROM ${table}
        WHERE expires_at <= now()
          OR (consumed_at IS NOT NULL AND consumed_at < now() - interval '1 day')
        ORDER BY expires_at ASC
        LIMIT 200
      )`);
}

export class DrizzleAiDashboardToolsRepository implements AiDashboardToolsRepository {
  constructor(private readonly externalSource: ExternalSourcePort) {}

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
      connection: this.externalSource.sourceConnection(row.source),
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
    const result = await this.externalSource.runBoundedReadOnlyQueryWithRetry(
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

  async issueComponentReceipt(input: {
    id: string;
    actorId: string;
    component: unknown;
    expiresAt: Date;
    dashboardId?: string;
    parameterBindings?: Record<string, string>;
  }) {
    await db.transaction(async (tx) => {
      await deleteStaleReceipts(tx, aiComponentReceipts);
      await tx.insert(aiComponentReceipts).values(input);
    });
  }

  async findComponentReceipt(id: string) {
    const [row] = await db
      .select()
      .from(aiComponentReceipts)
      .where(eq(aiComponentReceipts.id, id));
    return row;
  }

  /** Chamado pelo botão Aprovar do cartão; só o dono, dentro do prazo e antes do uso. */
  async approveComponentReceipt(
    id: string,
    actorId: string,
    values?: {
      contextValues: Record<string, string | string[]>;
      parameterValues: Record<string, string | string[]>;
    },
    now = new Date(),
  ) {
    const rows = await db
      .update(aiComponentReceipts)
      .set({
        approvedAt: now,
        ...(values
          ? {
              contextValues: values.contextValues,
              parameterValues: values.parameterValues,
            }
          : {}),
      })
      .where(
        and(
          eq(aiComponentReceipts.id, id),
          eq(aiComponentReceipts.actorId, actorId),
          isNull(aiComponentReceipts.consumedAt),
          gt(aiComponentReceipts.expiresAt, now),
        ),
      )
      .returning({ id: aiComponentReceipts.id });
    return rows.length === 1;
  }

  async issueReceipt(
    input: Parameters<AiDashboardToolsRepository["issueReceipt"]>[0],
    options?: Parameters<AiDashboardToolsRepository["issueReceipt"]>[1],
  ) {
    return db.transaction(async (tx) => {
      const consume = options?.consumeComponentReceipt;
      if (consume) {
        const rows = await tx
          .update(aiComponentReceipts)
          .set({ consumedAt: consume.now })
          .where(
            and(
              eq(aiComponentReceipts.id, consume.id),
              eq(aiComponentReceipts.actorId, consume.actorId),
              isNotNull(aiComponentReceipts.approvedAt),
              isNull(aiComponentReceipts.consumedAt),
              gt(aiComponentReceipts.expiresAt, consume.now),
            ),
          )
          .returning({ id: aiComponentReceipts.id });
        if (rows.length !== 1) return false;
      }
      await deleteStaleReceipts(tx, dashboardProposalReceipts);
      await tx.insert(dashboardProposalReceipts).values(input);
      return true;
    });
  }
}
