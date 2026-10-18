import { QueryInputValidationError, significantTokens, tokenizeSql, type Token } from "./sql-lexer.js";

const FORBIDDEN_KEYWORDS = new Set([
  "insert",
  "update",
  "delete",
  "merge",
  "drop",
  "alter",
  "create",
  "grant",
  "revoke",
  "truncate",
  "copy",
  "call",
  "do",
  "execute",
  "vacuum",
  "analyze",
  "set",
  "show",
  "listen",
  "notify",
  "into",
]);

const FORBIDDEN_FUNCTIONS = new Set([
  "nextval",
  "setval",
  "currval",
  "lastval",
  "set_config",
  "pg_sleep",
  "pg_sleep_for",
  "pg_sleep_until",
  "pg_advisory_lock",
  "pg_advisory_lock_shared",
  "pg_try_advisory_lock",
  "pg_try_advisory_lock_shared",
  "pg_advisory_xact_lock",
  "pg_advisory_xact_lock_shared",
  "pg_try_advisory_xact_lock",
  "pg_try_advisory_xact_lock_shared",
  "pg_cancel_backend",
  "pg_terminate_backend",
  "pg_reload_conf",
  "pg_read_file",
  "pg_read_binary_file",
  "pg_ls_dir",
  "pg_stat_file",
  "pg_logfile_rotate",
  "pg_create_restore_point",
  "pg_start_backup",
  "pg_stop_backup",
  "pg_switch_wal",
  "pg_rotate_logfile",
  "lo_import",
  "lo_export",
  "dblink",
  "dblink_exec",
  "dblink_connect",
  "dblink_connect_u",
  "dblink_disconnect",
  "postgres_fdw_get_connections",
  "postgres_fdw_disconnect",
]);

// AI previews resolve unqualified calls only against pg_catalog and deny every function outside this
// curated set. This keeps SECURITY DEFINER functions and side-effecting extension calls unavailable.

export function assertReadOnlySql(sqlText: string): void {
  let tokens: Token[];
  try {
    tokens = significantTokens(tokenizeSql(sqlText));
  } catch (error) {
    if (error instanceof QueryInputValidationError) throw error;
    throw new QueryInputValidationError(
      "INVALID_SQL",
      error instanceof Error ? error.message : "A query é inválida.",
    );
  }
  const words = tokens.filter((token) => token.kind === "word");
  const firstWord = words[0]?.value;
  if (firstWord !== "select" && firstWord !== "with") {
    throw new QueryInputValidationError(
      "INVALID_SQL",
      "A query deve começar com SELECT ou WITH.",
    );
  }
  if (
    tokens.some(
      (token) => token.kind === "word" && FORBIDDEN_KEYWORDS.has(token.value),
    )
  ) {
    throw new QueryInputValidationError(
      "INVALID_SQL",
      "A query contém uma operação não permitida. Somente consultas SELECT são aceitas.",
    );
  }
  if (
    words.some(
      (token, index) =>
        token.value === "for" &&
        ["share", "key"].includes(words[index + 1]?.value ?? ""),
    )
  ) {
    throw new QueryInputValidationError(
      "INVALID_SQL",
      "Consultas com bloqueio de linhas não são permitidas.",
    );
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind !== "word" && token.kind !== "quoted_identifier") continue;
    const normalizedName = token.value.toLocaleLowerCase("en-US");
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    const isFunctionName = next?.value === "(";
    const isQualifiedFunctionName =
      next?.value === "." &&
      tokens[index + 2]?.value !== undefined &&
      tokens[index + 3]?.value === "(";
    const functionName = isQualifiedFunctionName
      ? tokens[index + 2]!.value.toLocaleLowerCase("en-US")
      : normalizedName;
    const isFunctionLeaf = previous?.value === "." && isFunctionName;
    if (
      (isFunctionName || isQualifiedFunctionName || isFunctionLeaf) &&
      FORBIDDEN_FUNCTIONS.has(functionName)
    ) {
      throw new QueryInputValidationError(
        "INVALID_SQL",
        `A função '${functionName}' não é permitida em consultas somente leitura.`,
      );
    }
  }
}

export function normalizeGeneralReadOnlySql(sqlText: string): string {
  assertReadOnlySql(sqlText);
  return stripFinalTerminator(sqlText);
}

export function stripFinalTerminator(sqlText: string): string {
  const finalTerminator = tokenizeSql(sqlText).find(
    (token) => token.kind === "semicolon",
  );
  return (
    finalTerminator ? sqlText.slice(0, finalTerminator.start) : sqlText
  ).trim();
}
