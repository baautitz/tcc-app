import type { ExternalSourcePort } from "../domain/external-source.js";
import { findUnsafeAiColumnTypes, getPostgresTableColumns, listPostgresBaseTables, runBoundedReadOnlyQuery, runBoundedReadOnlyQueryWithRetry, runReadOnlyQuery } from "./external-pg/index.js";
import { sourceConnection } from "./source-connection.js";

export const externalSourceAdapter: ExternalSourcePort = {
  sourceConnection: (source) => sourceConnection(source),
  runReadOnlyQuery: (...a) => runReadOnlyQuery(...a),
  runBoundedReadOnlyQuery: (...a) => runBoundedReadOnlyQuery(...a),
  runBoundedReadOnlyQueryWithRetry: (...a) => runBoundedReadOnlyQueryWithRetry(...a),
  listPostgresBaseTables: (...a) => listPostgresBaseTables(...a),
  findUnsafeAiColumnTypes: (...a) => findUnsafeAiColumnTypes(...a),
  getPostgresTableColumns: (...a) => getPostgresTableColumns(...a),
};
