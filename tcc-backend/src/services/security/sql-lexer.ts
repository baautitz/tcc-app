import { DomainError } from "../../shared/lib/domain-error.js";
const MAX_SQL_CHARACTERS = 100_000;

export type Token = {
  kind:
    | "word"
    | "quoted_identifier"
    | "string"
    | "number"
    | "parameter"
    | "semicolon"
    | "operator"
    | "punctuation";
  value: string;
  start: number;
  end: number;
};

/** Tokenizes enough PostgreSQL syntax to validate statements without treating text inside comments or strings as SQL. */
export function tokenizeSql(sqlText: string): Token[] {
  if (sqlText.length > MAX_SQL_CHARACTERS)
    throw new Error("A query excede o tamanho máximo permitido.");
  const tokens: Token[] = [];
  let index = 0;

  while (index < sqlText.length) {
    const character = sqlText[index]!;
    const next = sqlText[index + 1];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (character === "-" && next === "-") {
      index += 2;
      while (
        index < sqlText.length &&
        sqlText[index] !== "\n" &&
        sqlText[index] !== "\r"
      )
        index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      index += 2;
      let depth = 1;
      while (index < sqlText.length && depth > 0) {
        if (sqlText[index] === "/" && sqlText[index + 1] === "*") {
          depth += 1;
          index += 2;
        } else if (sqlText[index] === "*" && sqlText[index + 1] === "/") {
          depth -= 1;
          index += 2;
        } else index += 1;
      }
      if (depth !== 0)
        throw new Error("A query contém um comentário SQL incompleto.");
      continue;
    }

    // PostgreSQL escape strings and ordinary strings; doubled quotes escape a quote.
    const prefixedString =
      /[bBnNxX]/.test(character) &&
      next === "'" &&
      (index === 0 || !/[\w$]/.test(sqlText[index - 1]!));
    const escapeString =
      (character === "e" || character === "E") &&
      next === "'" &&
      (index === 0 || !/[\w$]/.test(sqlText[index - 1]!));
    if (character === "'" || escapeString || prefixedString) {
      const start = index;
      index += escapeString || prefixedString ? 2 : 1;
      let closed = false;
      while (index < sqlText.length) {
        if (escapeString && sqlText[index] === "\\") {
          index += 2;
          continue;
        }
        if (sqlText[index] === "'" && sqlText[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (sqlText[index] === "'") {
          index += 1;
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed) throw new Error("A query contém uma string SQL incompleta.");
      tokens.push({ kind: "string", value: "", start, end: index });
      continue;
    }

    // Dollar-quoted strings, including function bodies and tagged strings.
    if (character === "$") {
      const delimiter = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(
        sqlText.slice(index),
      )?.[0];
      if (delimiter) {
        const closeAt = sqlText.indexOf(delimiter, index + delimiter.length);
        if (closeAt < 0)
          throw new Error("A query contém uma string SQL incompleta.");
        tokens.push({
          kind: "string",
          value: "",
          start: index,
          end: closeAt + delimiter.length,
        });
        index = closeAt + delimiter.length;
        continue;
      }
    }

    if (character === '"') {
      const start = index++;
      let value = "";
      let closed = false;
      while (index < sqlText.length) {
        if (sqlText[index] === '"' && sqlText[index + 1] === '"') {
          value += '"';
          index += 2;
          continue;
        }
        if (sqlText[index] === '"') {
          index += 1;
          closed = true;
          break;
        }
        value += sqlText[index]!;
        index += 1;
      }
      if (!closed)
        throw new Error("A query contém um identificador SQL incompleto.");
      tokens.push({ kind: "quoted_identifier", value, start, end: index });
      continue;
    }

    if (character === "{" && next === "{") {
      const match = /^\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/.exec(
        sqlText.slice(index),
      );
      if (match) {
        tokens.push({
          kind: "parameter",
          value: match[1]!,
          start: index,
          end: index + match[0].length,
        });
        index += match[0].length;
        continue;
      }
    }

    if (character === ";") {
      tokens.push({
        kind: "semicolon",
        value: character,
        start: index,
        end: index + 1,
      });
      index += 1;
      continue;
    }

    if (character === ":" && next === ":") {
      tokens.push({
        kind: "operator",
        value: "::",
        start: index,
        end: index + 2,
      });
      index += 2;
      continue;
    }

    if ("().,[]".includes(character)) {
      tokens.push({
        kind: "punctuation",
        value: character,
        start: index,
        end: index + 1,
      });
      index += 1;
      continue;
    }

    if (/[0-9]/.test(character)) {
      const start = index++;
      while (index < sqlText.length && /[0-9]/.test(sqlText[index]!))
        index += 1;
      tokens.push({
        kind: "number",
        value: sqlText.slice(start, index),
        start,
        end: index,
      });
      continue;
    }

    if (character === ":") {
      tokens.push({
        kind: "punctuation",
        value: character,
        start: index,
        end: index + 1,
      });
      index += 1;
      continue;
    }

    if ("+-*/<>=~!@#%^&|`?".includes(character)) {
      const start = index++;
      while (
        index < sqlText.length &&
        "+-*/<>=~!@#%^&|`?".includes(sqlText[index]!)
      )
        index += 1;
      tokens.push({
        kind: "operator",
        value: sqlText.slice(start, index),
        start,
        end: index,
      });
      continue;
    }

    if (/[A-Za-z_]/.test(character)) {
      const start = index++;
      while (index < sqlText.length && /[A-Za-z0-9_$]/.test(sqlText[index]!))
        index += 1;
      tokens.push({
        kind: "word",
        value: sqlText.slice(start, index).toLocaleLowerCase("en-US"),
        start,
        end: index,
      });
      continue;
    }

    index += 1;
  }
  return tokens;
}

export function significantTokens(tokens: Token[]): Token[] {
  const semicolons = tokens.filter((token) => token.kind === "semicolon");
  if (
    semicolons.length > 1 ||
    (semicolons.length === 1 && tokens.at(-1) !== semicolons[0])
  ) {
    throw new Error("A query deve conter somente uma instrução SQL.");
  }
  return semicolons.length ? tokens.slice(0, -1) : tokens;
}

export class QueryInputValidationError extends DomainError {
  constructor(
    public readonly code:
      | "INVALID_SQL"
      | "INVALID_PARAMETERS"
      | "MISSING_PARAMETERS",
    message: string,
  ) {
    super(message, code, "bad_request");
    this.name = "QueryInputValidationError";
  }
}

export function normalizeIdentifier(token: Token): string {
  return token.kind === "word"
    ? token.value.toLocaleLowerCase("en-US")
    : token.value;
}
