import { QueryInputValidationError, normalizeIdentifier, significantTokens, tokenizeSql, type Token } from "./sql-lexer.js";
import { assertReadOnlySql, stripFinalTerminator } from "./policy-general.js";
import { assertAiCastTypes } from "./policy-ai/casts.js";
import { SAFE_FUNCTIONS } from "./policy-ai/safe-lists.js";

/** Applies the stricter function and namespace policy only to SQL executed by the AI preview tool. */
export function assertAiReadOnlySql(sqlText: string): void {
  assertReadOnlySql(sqlText);
  const tokens = significantTokens(tokenizeSql(sqlText));
  assertAiCastTypes(tokens);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind !== "word" && token.kind !== "quoted_identifier") continue;
    if (isAliasColumnList(tokens, index)) continue;
    // `AS (` is CTE syntax, not a function call. Treating it as a call
    // incorrectly sends the SQL keyword `as` through the function allowlist.
    if (token.kind === "word" && token.value === "as") continue;
    const functionName = normalizeIdentifier(token);
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    const isFunctionCall = next?.value === "(";
    if (!isFunctionCall) continue;
    const qualified = previous?.value === ".";
    const schemaName = qualified
      ? tokens[index - 2]
        ? normalizeIdentifier(tokens[index - 2]!)
        : undefined
      : undefined;
    if (
      (schemaName !== undefined && schemaName !== "pg_catalog") ||
      !SAFE_FUNCTIONS.has(functionName)
    ) {
      throw new QueryInputValidationError(
        "INVALID_SQL",
        `A função '${functionName}' não pertence à lista segura de funções PostgreSQL permitidas pela IA.`,
      );
    }
  }
  if (
    tokens.some(
      (token, index) =>
        token.kind === "word" &&
        token.value === "operator" &&
        tokens[index + 1]?.value === "(",
    )
  ) {
    throw new QueryInputValidationError(
      "INVALID_SQL",
      "A sintaxe OPERATOR(...) não é permitida em consultas assistidas.",
    );
  }
}

function isAliasColumnList(tokens: Token[], nameIndex: number): boolean {
  if (tokens[nameIndex + 1]?.value !== "(") return false;
  let depth = 0;
  let closingIndex = -1;
  for (let index = nameIndex + 1; index < tokens.length; index += 1) {
    if (tokens[index]?.value === "(") depth += 1;
    else if (tokens[index]?.value === ")") {
      depth -= 1;
      if (depth === 0) {
        closingIndex = index;
        break;
      }
    }
  }
  if (closingIndex < 0) return false;
  const content = tokens.slice(nameIndex + 2, closingIndex);
  const columnList =
    content.length > 0 &&
    content.every((part, index) =>
      index % 2 === 0
        ? part.kind === "word" || part.kind === "quoted_identifier"
        : part.value === ",",
    );
  if (!columnList) return false;
  if (
    tokens[closingIndex + 1]?.value === "as" &&
    tokens[closingIndex + 2]?.value === "("
  )
    return true;
  return tokens[nameIndex - 1]?.value === "as";
}

export function normalizeReadOnlySql(sqlText: string): string {
  assertAiReadOnlySql(sqlText);
  return stripFinalTerminator(sqlText);
}
