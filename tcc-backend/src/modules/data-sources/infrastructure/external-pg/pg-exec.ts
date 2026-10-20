import { Client } from "pg";
import {
  AI_QUERY_CONNECTION_TIMEOUT_MS,
  AI_QUERY_MAX_BYTES,
  AI_QUERY_MAX_ROWS,
  AI_QUERY_RETRY_JITTER_MS,
  AI_QUERY_RETRY_MIN_DELAY_MS,
  AI_QUERY_STATEMENT_TIMEOUT_MS,
  ExternalQueryExecutionError,
  type BoundedReadOnlyClient,
  type BoundedReadOnlyQueryOptions,
  type BoundedReadOnlyQueryResult,
  type CursorQuery,
  type ExternalPostgresConfig,
} from "../../domain/external-source.js";
export * from "../../domain/external-source.js";
import Cursor from "pg-cursor";
import {
  normalizeGeneralReadOnlySql,
  normalizeReadOnlySql,
} from "../../../../shared/security/query-security.js";
export function classifyExternalQueryError(
  error: unknown,
): ExternalQueryExecutionError {
  const source =
    error && typeof error === "object"
      ? (error as { code?: unknown; message?: unknown })
      : {};
  const code = typeof source.code === "string" ? source.code : "";
  const message = typeof source.message === "string" ? source.message : "";
  const timeout =
    code === "57014" || (!code && /timeout|timed out/i.test(message));
  const retryableTransportCodes = new Set([
    "08000",
    "08001",
    "08003",
    "08006",
    "08007",
    "08P01",
    "ECONNRESET",
    "ECONNREFUSED",
    "EPIPE",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EAI_AGAIN",
    "ETIMEDOUT",
  ]);
  if (timeout)
    return new ExternalQueryExecutionError("timeout", code || null, false);
  if (retryableTransportCodes.has(code) || code.startsWith("08")) {
    return new ExternalQueryExecutionError("connection", code || null, true);
  }
  return new ExternalQueryExecutionError(
    "database",
    /^[0-9A-Z]{5}$/.test(code) ? code : null,
    false,
  );
}

function defaultBoundedClient(
  config: ExternalPostgresConfig,
): BoundedReadOnlyClient {
  return new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionTimeoutMillis: AI_QUERY_CONNECTION_TIMEOUT_MS,
    statement_timeout: AI_QUERY_STATEMENT_TIMEOUT_MS,
  }) as unknown as BoundedReadOnlyClient;
}

function rowByteLength(row: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(row), "utf8");
}

/** Executes an AI query in a read-only transaction, fetching one bounded row at a time. */
export async function runBoundedReadOnlyQuery(
  config: ExternalPostgresConfig,
  sqlText: string,
  values: unknown[],
  options: BoundedReadOnlyQueryOptions = {},
): Promise<BoundedReadOnlyQueryResult> {
  const rowLimit = options.rowLimit ?? AI_QUERY_MAX_ROWS;
  const byteLimit = options.byteLimit ?? AI_QUERY_MAX_BYTES;
  if (
    !Number.isSafeInteger(rowLimit) ||
    rowLimit < 1 ||
    rowLimit > AI_QUERY_MAX_ROWS
  )
    throw new Error("Limite de linhas inválido.");
  if (
    !Number.isSafeInteger(byteLimit) ||
    byteLimit < 1 ||
    byteLimit > AI_QUERY_MAX_BYTES
  )
    throw new Error("Limite de bytes inválido.");
  const safeSql = options.allowGeneralReadOnlySql
    ? normalizeGeneralReadOnlySql(sqlText)
    : normalizeReadOnlySql(sqlText);
  const boundedSql = `
    SELECT
      CASE WHEN octet_length(encoded.row_json) <= ${byteLimit} THEN encoded.row_json ELSE NULL END AS "__ai_row_json",
      octet_length(encoded.row_json) AS "__ai_row_bytes"
    FROM (${safeSql}) AS "__ai_query_source"
    CROSS JOIN LATERAL (SELECT to_jsonb("__ai_query_source")::text AS row_json) AS encoded
    LIMIT ${rowLimit + 1}
  `;
  const client = (options.createClient ?? defaultBoundedClient)(config);
  const createCursor =
    options.createCursor ??
    ((query, queryValues) =>
      new Cursor(query, queryValues) as unknown as CursorQuery);
  let connected = false;
  let transactionOpen = false;
  let cursor: CursorQuery | undefined;
  try {
    await client.connect();
    connected = true;
    await client.query("BEGIN READ ONLY");
    transactionOpen = true;
    await client.query(
      `SET LOCAL statement_timeout = '${AI_QUERY_STATEMENT_TIMEOUT_MS}ms'`,
    );
    if (!options.preserveConfiguredSearchPath) {
      // Only pg_catalog functions/operators are resolvable implicitly. User tables must be schema-qualified.
      await client.query("SET LOCAL search_path = pg_catalog");
    }
    // pg-cursor has no stable AbortSignal cancellation API. An active fetch remains
    // bounded by statement_timeout; the caller discards its result after an abort.
    cursor = createCursor(boundedSql, values);
    await client.query(cursor);

    const rows: Record<string, unknown>[] = [];
    let bytes = 2; // JSON array brackets.
    let truncated = false;
    let truncationReason: BoundedReadOnlyQueryResult["truncationReason"] = null;
    while (true) {
      const nextRows = await cursor.read(1);
      if (nextRows.length === 0) break;
      const encodedRow = nextRows[0]!;
      if (rows.length >= rowLimit) {
        truncated = true;
        truncationReason = "row_limit";
        break;
      }
      const rowJson = encodedRow.__ai_row_json;
      const encodedBytes = Number(encodedRow.__ai_row_bytes);
      if (
        rowJson === null ||
        typeof rowJson !== "string" ||
        !Number.isSafeInteger(encodedBytes) ||
        encodedBytes > byteLimit
      ) {
        truncated = true;
        truncationReason = "byte_limit";
        break;
      }
      let row: Record<string, unknown>;
      try {
        row = parseJsonPreservingNumbers(rowJson);
      } catch {
        throw new Error(
          "O servidor retornou uma linha que não pôde ser interpretada.",
        );
      }
      let nextRowBytes: number;
      try {
        nextRowBytes = rowByteLength(row) + (rows.length > 0 ? 1 : 0);
      } catch {
        throw new Error(
          "O resultado contém valores que não podem ser serializados com segurança.",
        );
      }
      if (bytes + nextRowBytes > byteLimit) {
        truncated = true;
        truncationReason = "byte_limit";
        break;
      }
      rows.push(row);
      bytes += nextRowBytes;
    }

    await cursor.close();
    cursor = undefined;
    await client.query("COMMIT");
    transactionOpen = false;
    return { rows, rowLimit, byteLimit, bytes, truncated, truncationReason };
  } catch (error) {
    if (error instanceof ExternalQueryExecutionError) throw error;
    throw classifyExternalQueryError(error);
  } finally {
    if (cursor) await cursor.close().catch(() => undefined);
    if (connected && transactionOpen)
      await client.query("ROLLBACK").catch(() => undefined);
    if (connected) await client.end().catch(() => undefined);
  }
}

/** Preserves PostgreSQL JSON numeric lexemes as strings, avoiding JS precision loss for int8/numeric. */
function parseJsonPreservingNumbers(jsonText: string): Record<string, unknown> {
  let quoted = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < jsonText.length;) {
    const character = jsonText[index]!;
    if (inString) {
      quoted += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      index += 1;
      continue;
    }
    if (character === '"') {
      inString = true;
      quoted += character;
      index += 1;
      continue;
    }
    if (character === "-" || /[0-9]/.test(character)) {
      const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
        jsonText.slice(index),
      )?.[0];
      if (number) {
        quoted += JSON.stringify(number);
        index += number.length;
        continue;
      }
    }
    quoted += character;
    index += 1;
  }
  const parsed: unknown = JSON.parse(quoted);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Expected a JSON object");
  return parsed as Record<string, unknown>;
}
