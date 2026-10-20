import type { ExternalSourcePort } from "../domain/external-source.js";
import {
  findUnsafeAiColumnTypes,
  getPostgresTableColumns,
  listPostgresBaseTables,
  runBoundedReadOnlyQuery,
  runBoundedReadOnlyQueryWithRetry,
  runReadOnlyQuery,
} from "./external-pg/index.js";
import { sourceConnection } from "./source-connection.js";

export class PostgresExternalSourceAdapter implements ExternalSourcePort {
  sourceConnection: ExternalSourcePort["sourceConnection"] = (source) =>
    sourceConnection(source);
  runReadOnlyQuery: ExternalSourcePort["runReadOnlyQuery"] = (...a) =>
    runReadOnlyQuery(...a);
  runBoundedReadOnlyQuery: ExternalSourcePort["runBoundedReadOnlyQuery"] = (
    ...a
  ) => runBoundedReadOnlyQuery(...a);
  runBoundedReadOnlyQueryWithRetry: ExternalSourcePort["runBoundedReadOnlyQueryWithRetry"] =
    (...a) => runBoundedReadOnlyQueryWithRetry(...a);
  listPostgresBaseTables: ExternalSourcePort["listPostgresBaseTables"] = (
    ...a
  ) => listPostgresBaseTables(...a);
  findUnsafeAiColumnTypes: ExternalSourcePort["findUnsafeAiColumnTypes"] = (
    ...a
  ) => findUnsafeAiColumnTypes(...a);
  getPostgresTableColumns: ExternalSourcePort["getPostgresTableColumns"] = (
    ...a
  ) => getPostgresTableColumns(...a);
}

export const externalSourceAdapter = new PostgresExternalSourceAdapter();
