import { DomainError } from "../../../shared/lib/domain-error.js";
import { sha256Hex } from "../../../shared/lib/hash.js";
import type { ParameterDefinition } from "../../../shared/lib/contracts.js";

export const QUERY_TEST_RECEIPT_TTL_MS = 10 * 60 * 1_000;

export type QuerySaveMode = "create" | "update";

export interface QueryLifecycleSource {
  id: string;
  updatedAt: Date;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  encryptedPassword: string;
}

export interface QueryLifecycleQuery {
  id: string;
  dataSourceId: string;
  name: string;
  sqlText: string;
  parameters: unknown;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface QueryTestReceipt {
  id: string;
  actorId: string;
  dataSourceId: string;
  sourceUpdatedAt: Date;
  sourceTargetHash: string;
  draftFingerprint: string;
  mode: QuerySaveMode;
  queryId: string | null;
  queryUpdatedAt: Date | null;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface QueryTestReceiptInput {
  actorId: string;
  dataSourceId: string;
  sourceUpdatedAt: Date;
  sourceTargetHash: string;
  draftFingerprint: string;
  mode: QuerySaveMode;
  queryId: string | null;
  queryUpdatedAt: Date | null;
  expiresAt: Date;
}

export interface QueryLifecycleTransaction {
  lockSource(dataSourceId: string): Promise<QueryLifecycleSource | undefined>;
  lockQuery(queryId: string): Promise<QueryLifecycleQuery | undefined>;
  insertReceipt(receipt: QueryTestReceiptInput): Promise<QueryTestReceipt>;
  consumeReceipt(
    receiptId: string,
    actorId: string,
    now: Date,
  ): Promise<QueryTestReceipt | undefined>;
  insertQuery(
    query: Omit<QueryLifecycleQuery, "id" | "createdAt" | "updatedAt">,
  ): Promise<QueryLifecycleQuery>;
  updateQuery(
    queryId: string,
    update: Pick<
      QueryLifecycleQuery,
      "dataSourceId" | "name" | "sqlText" | "parameters" | "updatedAt"
    >,
  ): Promise<QueryLifecycleQuery | undefined>;
}

export interface QueryLifecycleRepository {
  transaction<T>(
    operation: (tx: QueryLifecycleTransaction) => Promise<T>,
  ): Promise<T>;
}

export class QueryLifecycleError extends DomainError {
  constructor(
    public readonly code:
      | "SOURCE_NOT_FOUND"
      | "QUERY_NOT_FOUND"
      | "RECEIPT_INVALID"
      | "RECEIPT_STALE"
      | "QUERY_VERSION_CONFLICT",
  ) {
    super(code, code, code.endsWith("NOT_FOUND") ? "not_found" : "conflict");
    this.name = "QueryLifecycleError";
  }
}

export function canonicalQueryDraft(input: {
  dataSourceId: string;
  sqlText: string;
  parameters: ParameterDefinition[];
}): string {
  const parameters = input.parameters
    .map((parameter) => ({
      name: parameter.name.trim(),
      label: parameter.label.trim(),
      type: parameter.type,
      required: parameter.required,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "en-US"));
  return JSON.stringify({
    dataSourceId: input.dataSourceId,
    sqlText: input.sqlText.replace(/\r\n?/g, "\n").trim(),
    parameters,
  });
}

export function queryDraftFingerprint(input: {
  dataSourceId: string;
  sqlText: string;
  parameters: ParameterDefinition[];
}): string {
  return sha256Hex(canonicalQueryDraft(input));
}

export function querySourceTargetHash(source: QueryLifecycleSource): string {
  const target = JSON.stringify({
    host: source.host,
    port: source.port,
    databaseName: source.databaseName,
    username: source.username,
    encryptedPassword: source.encryptedPassword,
  });
  return sha256Hex(target);
}

export async function issueQueryTestReceipt(
  repository: QueryLifecycleRepository,
  input: {
    actorId: string;
    dataSourceId: string;
    sourceUpdatedAt: Date;
    sourceTargetHash: string;
    draftFingerprint: string;
    mode: QuerySaveMode;
    queryId?: string;
    queryUpdatedAt?: Date;
    now?: Date;
  },
): Promise<string> {
  const now = input.now ?? new Date();
  return repository.transaction(async (tx) => {
    const source = await tx.lockSource(input.dataSourceId);
    if (!source) throw new QueryLifecycleError("SOURCE_NOT_FOUND");
    if (
      source.updatedAt.getTime() !== input.sourceUpdatedAt.getTime() ||
      querySourceTargetHash(source) !== input.sourceTargetHash
    ) {
      throw new QueryLifecycleError("RECEIPT_STALE");
    }

    let queryUpdatedAt: Date | null = null;
    if (input.mode === "update") {
      if (!input.queryId || !input.queryUpdatedAt) {
        throw new QueryLifecycleError("RECEIPT_STALE");
      }
      const query = await tx.lockQuery(input.queryId);
      if (!query || query.dataSourceId !== input.dataSourceId) {
        throw new QueryLifecycleError("QUERY_NOT_FOUND");
      }
      if (query.updatedAt.getTime() !== input.queryUpdatedAt.getTime()) {
        throw new QueryLifecycleError("QUERY_VERSION_CONFLICT");
      }
      queryUpdatedAt = query.updatedAt;
    }

    const receipt = await tx.insertReceipt({
      actorId: input.actorId,
      dataSourceId: input.dataSourceId,
      sourceUpdatedAt: source.updatedAt,
      sourceTargetHash: querySourceTargetHash(source),
      draftFingerprint: input.draftFingerprint,
      mode: input.mode,
      queryId: input.mode === "update" ? input.queryId! : null,
      queryUpdatedAt,
      expiresAt: new Date(now.getTime() + QUERY_TEST_RECEIPT_TTL_MS),
    });
    return receipt.id;
  });
}

export async function saveQueryWithTestReceipt(
  repository: QueryLifecycleRepository,
  input: {
    receiptId: string;
    actorId: string;
    mode: QuerySaveMode;
    queryId?: string;
    expectedUpdatedAt?: Date;
    dataSourceId: string;
    name: string;
    sqlText: string;
    parameters: ParameterDefinition[];
    createdBy: string;
    now?: Date;
  },
): Promise<QueryLifecycleQuery> {
  const now = input.now ?? new Date();
  const fingerprint = queryDraftFingerprint(input);
  return repository.transaction(async (tx) => {
    const source = await tx.lockSource(input.dataSourceId);
    if (!source) throw new QueryLifecycleError("SOURCE_NOT_FOUND");

    const receipt = await tx.consumeReceipt(
      input.receiptId,
      input.actorId,
      now,
    );
    if (!receipt) throw new QueryLifecycleError("RECEIPT_INVALID");
    if (
      receipt.dataSourceId !== input.dataSourceId ||
      receipt.mode !== input.mode ||
      receipt.draftFingerprint !== fingerprint ||
      receipt.sourceUpdatedAt.getTime() !== source.updatedAt.getTime() ||
      receipt.sourceTargetHash !== querySourceTargetHash(source)
    ) {
      throw new QueryLifecycleError("RECEIPT_STALE");
    }

    if (input.mode === "create") {
      if (
        receipt.queryId !== null ||
        receipt.queryUpdatedAt !== null ||
        input.queryId ||
        input.expectedUpdatedAt
      ) {
        throw new QueryLifecycleError("RECEIPT_STALE");
      }
      return tx.insertQuery({
        dataSourceId: input.dataSourceId,
        name: input.name,
        sqlText: input.sqlText,
        parameters: input.parameters,
        createdBy: input.createdBy,
      });
    }

    if (!input.queryId || !input.expectedUpdatedAt) {
      throw new QueryLifecycleError("RECEIPT_STALE");
    }
    if (
      receipt.queryId !== input.queryId ||
      !receipt.queryUpdatedAt ||
      receipt.queryUpdatedAt.getTime() !== input.expectedUpdatedAt.getTime()
    ) {
      throw new QueryLifecycleError("RECEIPT_STALE");
    }
    const query = await tx.lockQuery(input.queryId);
    if (!query) throw new QueryLifecycleError("QUERY_NOT_FOUND");
    if (
      query.dataSourceId !== input.dataSourceId ||
      query.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
    ) {
      throw new QueryLifecycleError("QUERY_VERSION_CONFLICT");
    }
    const updatedAt = new Date(
      Math.max(now.getTime(), query.updatedAt.getTime() + 1),
    );
    const updated = await tx.updateQuery(input.queryId, {
      dataSourceId: input.dataSourceId,
      name: input.name,
      sqlText: input.sqlText,
      parameters: input.parameters,
      updatedAt,
    });
    if (!updated) throw new QueryLifecycleError("QUERY_NOT_FOUND");
    return updated;
  });
}
