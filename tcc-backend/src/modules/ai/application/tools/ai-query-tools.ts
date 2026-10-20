export { createAiQueryTestTools } from "./query-test/query-test-tool.js";
export type {
  AiQueryTestRepository,
  AiQueryTestResult,
  CreateAiQueryTestToolsOptions,
} from "./query-test/query-test-schema.js";
import {
  MAX_DATABASE_ATTEMPTS,
  MAX_SQL_DRAFT_CHARACTERS,
} from "./query-test/query-test-schema.js";

export const AI_QUERY_TEST_LIMITS = {
  maxSqlDraftCharacters: MAX_SQL_DRAFT_CHARACTERS,
  maxDatabaseAttempts: MAX_DATABASE_ATTEMPTS,
} as const;
