import {
  QueryInputValidationError,
  normalizeIdentifier,
  significantTokens,
  tokenizeSql,
  type Token,
} from "./sql-lexer.js";

export interface AiCatalogTableReference {
  schemaName: string;
  tableName: string;
}

/** Limits AI SQL relations to currently catalogued base tables, so a view cannot hide executable user code. */
export function assertAiCatalogTableReferences(
  sqlText: string,
  knownTables: AiCatalogTableReference[],
): AiCatalogTableReference[] {
  const tokens = significantTokens(tokenizeSql(sqlText));
  const ctes = collectCteNames(tokens);
  const known = new Set(
    knownTables.map((table) => `${table.schemaName}\u0000${table.tableName}`),
  );
  const referenced = new Map<string, AiCatalogTableReference>();
  const depths: number[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.value === ")") depth -= 1;
    depths.push(depth);
    if (token.value === "(") depth += 1;
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (
      token.kind !== "word" ||
      (token.value !== "from" && token.value !== "join")
    )
      continue;
    const directRelation = assertRelationAt(tokens, index + 1, ctes, known);
    if (directRelation)
      referenced.set(
        `${directRelation.schemaName}\u0000${directRelation.tableName}`,
        directRelation,
      );
    if (token.value !== "from") continue;

    const clauseDepth = depths[index]!;
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      if (depths[cursor] !== clauseDepth) continue;
      const current = tokens[cursor]!;
      if (
        current.kind === "word" &&
        [
          "where",
          "group",
          "order",
          "having",
          "limit",
          "offset",
          "fetch",
          "union",
          "intersect",
          "except",
          "window",
          "for",
        ].includes(current.value)
      )
        break;
      if (current.value === ",") {
        const commaRelation = assertRelationAt(tokens, cursor + 1, ctes, known);
        if (commaRelation)
          referenced.set(
            `${commaRelation.schemaName}\u0000${commaRelation.tableName}`,
            commaRelation,
          );
      }
    }
  }
  return [...referenced.values()];
}

function collectCteNames(tokens: Token[]): Set<string> {
  const ctes = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.kind !== "word" || tokens[index]?.value !== "with")
      continue;
    let cursor = index + 1;
    if (tokens[cursor]?.value === "recursive") cursor += 1;
    while (true) {
      const name = tokens[cursor];
      if (!name || (name.kind !== "word" && name.kind !== "quoted_identifier"))
        break;
      ctes.add(normalizeIdentifier(name));
      cursor += 1;
      if (tokens[cursor]?.value === "(")
        cursor = skipBalancedParentheses(tokens, cursor);
      if (tokens[cursor]?.value !== "as") break;
      cursor += 1;
      if (tokens[cursor]?.value === "not") cursor += 1;
      if (tokens[cursor]?.value === "materialized") cursor += 1;
      if (tokens[cursor]?.value !== "(") break;
      cursor = skipBalancedParentheses(tokens, cursor);
      if (tokens[cursor]?.value !== ",") break;
      cursor += 1;
    }
  }
  return ctes;
}

function skipBalancedParentheses(tokens: Token[], openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index]?.value === "(") depth += 1;
    else if (tokens[index]?.value === ")") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return tokens.length;
}

function assertRelationAt(
  tokens: Token[],
  start: number,
  ctes: Set<string>,
  known: Set<string>,
): AiCatalogTableReference | undefined {
  let index = start;
  while (["only", "lateral"].includes(tokens[index]?.value ?? "")) index += 1;
  const relation = tokens[index];
  if (!relation) return undefined;
  if (relation.value === "(") {
    const firstInside = tokens[index + 1];
    if (["select", "with", "values"].includes(firstInside?.value ?? ""))
      return undefined;
    return assertRelationAt(tokens, index + 1, ctes, known);
  }
  if (relation.kind !== "word" && relation.kind !== "quoted_identifier")
    return undefined;

  const firstName = normalizeIdentifier(relation);
  const dot = tokens[index + 1];
  const secondName = tokens[index + 2];
  if (
    dot?.value === "." &&
    secondName &&
    (secondName.kind === "word" || secondName.kind === "quoted_identifier")
  ) {
    // A following parenthesis is a table-valued function, whose function name is checked by the allowlist.
    if (tokens[index + 3]?.value === "(") return undefined;
    const key = `${firstName}\u0000${normalizeIdentifier(secondName)}`;
    if (!known.has(key))
      throw new QueryInputValidationError(
        "INVALID_SQL",
        `A tabela '${firstName}.${normalizeIdentifier(secondName)}' não pertence ao catálogo base atualizado do servidor.`,
      );
    return {
      schemaName: firstName,
      tableName: normalizeIdentifier(secondName),
    };
  }
  if (tokens[index + 1]?.value === "(") return undefined;
  if (ctes.has(firstName)) return undefined;
  throw new QueryInputValidationError(
    "INVALID_SQL",
    `Qualifique o schema da tabela '${firstName}' e use somente tabelas base catalogadas neste servidor.`,
  );
}
