import type { ParameterDefinition } from "../lib/contracts.js";

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
const SAFE_FUNCTIONS = new Set([
  "abs",
  "acos",
  "age",
  "array",
  "array_agg",
  "array_append",
  "array_cat",
  "array_dims",
  "array_fill",
  "array_length",
  "array_lower",
  "array_ndims",
  "array_position",
  "array_positions",
  "array_prepend",
  "array_remove",
  "array_replace",
  "array_to_string",
  "array_upper",
  "ascii",
  "asin",
  "atan",
  "atan2",
  "avg",
  "btrim",
  "cardinality",
  "cast",
  "ceil",
  "ceiling",
  "char_length",
  "character_length",
  "chr",
  "coalesce",
  "concat",
  "concat_ws",
  "count",
  "current_schema",
  "date_part",
  "date_trunc",
  "decode",
  "degrees",
  "dense_rank",
  "div",
  "encode",
  "every",
  "exists",
  "exp",
  "extract",
  "factorial",
  "first_value",
  "floor",
  "format",
  "generate_series",
  "greatest",
  "in",
  "any",
  "all",
  "some",
  "values",
  "filter",
  "over",
  "rollup",
  "cube",
  "sets",
  "grouping",
  "jsonb_array_elements",
  "jsonb_array_elements_text",
  "jsonb_array_length",
  "jsonb_build_array",
  "jsonb_build_object",
  "jsonb_each",
  "jsonb_each_text",
  "jsonb_extract_path",
  "jsonb_extract_path_text",
  "jsonb_object_keys",
  "jsonb_pretty",
  "jsonb_strip_nulls",
  "jsonb_typeof",
  "json_build_array",
  "json_build_object",
  "json_each",
  "json_each_text",
  "json_extract_path",
  "json_extract_path_text",
  "json_object_keys",
  "json_typeof",
  "lag",
  "last_value",
  "lead",
  "least",
  "length",
  "ln",
  "log",
  "lower",
  "lpad",
  "ltrim",
  "make_date",
  "make_interval",
  "make_time",
  "make_timestamp",
  "max",
  "md5",
  "min",
  "mod",
  "now",
  "nth_value",
  "ntile",
  "nullif",
  "octet_length",
  "overlay",
  "percent_rank",
  "pi",
  "position",
  "power",
  "quote_ident",
  "quote_literal",
  "rank",
  "regexp_match",
  "regexp_matches",
  "regexp_replace",
  "repeat",
  "replace",
  "reverse",
  "round",
  "row",
  "row_number",
  "rpad",
  "rtrim",
  "sign",
  "sin",
  "split_part",
  "sqrt",
  "stddev",
  "stddev_pop",
  "stddev_samp",
  "string_agg",
  "substr",
  "substring",
  "sum",
  "tan",
  "to_char",
  "to_date",
  "to_json",
  "to_jsonb",
  "to_number",
  "to_timestamp",
  "translate",
  "trim",
  "trunc",
  "upper",
  "variance",
  "var_pop",
  "var_samp",
  "width_bucket",
  // Built-in scalar type constructors are aliases for safe input casts.
  "bigint",
  "bigserial",
  "bit",
  "boolean",
  "char",
  "character",
  "date",
  "decimal",
  "double",
  "float",
  "int",
  "int2",
  "int4",
  "int8",
  "integer",
  "interval",
  "json",
  "jsonb",
  "numeric",
  "real",
  "serial",
  "smallint",
  "text",
  "time",
  "timestamp",
  "timestamptz",
  "timetz",
  "uuid",
  "varchar",
  "varbit",
  "bool_and",
  "bool_or",
  "bit_and",
  "bit_or",
  "jsonb_set",
  "jsonb_set_lax",
  "unnest",
  "generate_subscripts",
]);

// PostgreSQL casts and typed string literals can invoke arbitrary type input/output
// functions. Keep the AI policy independent from the saved-query policy below.
const SAFE_TYPE_NAMES = [
  "abstime",
  "aclitem",
  "bigint",
  "bigserial",
  "bit",
  "bit varying",
  "bool",
  "boolean",
  "bpchar",
  "box",
  "bytea",
  "char",
  "character",
  "character varying",
  "cid",
  "cidr",
  "circle",
  "date",
  "daterange",
  "datemultirange",
  "decimal",
  "double precision",
  "float",
  "float4",
  "float8",
  "gtsvector",
  "inet",
  "int",
  "int2",
  "int4",
  "int8",
  "integer",
  "interval",
  "json",
  "jsonb",
  "line",
  "lseg",
  "macaddr",
  "macaddr8",
  "money",
  "name",
  "national character",
  "national character varying",
  "national char",
  "national char varying",
  "numeric",
  "numrange",
  "nummultirange",
  "oid",
  "oidvector",
  "path",
  "pg_lsn",
  "pg_snapshot",
  "point",
  "polygon",
  "real",
  "refcursor",
  "regclass",
  "regcollation",
  "regconfig",
  "regdictionary",
  "regnamespace",
  "regoper",
  "regoperator",
  "regproc",
  "regprocedure",
  "regrole",
  "regtype",
  "serial",
  "serial2",
  "serial4",
  "serial8",
  "smallint",
  "smallserial",
  "text",
  "tid",
  "time",
  "time with time zone",
  "time without time zone",
  "timestamp",
  "timestamp with time zone",
  "timestamp without time zone",
  "timestamptz",
  "timetz",
  "tsquery",
  "tsrange",
  "tsmultirange",
  "tsvector",
  "tstzrange",
  "tstzmultirange",
  "uuid",
  "varbit",
  "varchar",
  "xid",
  "xid8",
  "xml",
].sort((left, right) => right.split(" ").length - left.split(" ").length);

const SAFE_TYPE_MODIFIER_NAMES = new Set([
  "bit",
  "bit varying",
  "character",
  "character varying",
  "decimal",
  "double precision",
  "float",
  "numeric",
  "national character",
  "national character varying",
  "national char",
  "national char varying",
  "time",
  "time with time zone",
  "time without time zone",
  "timestamp",
  "timestamp with time zone",
  "timestamp without time zone",
  "varchar",
  "varbit",
]);

const MAX_SQL_CHARACTERS = 100_000;
const MAX_PARAMETERS = 50;
const MAX_PARAMETER_VALUE_CHARACTERS = 2_048;
const MAX_PARAMETER_ARRAY_ITEMS = 50;
const MAX_PARAMETER_TOTAL_CHARACTERS = 16_384;

type Token = {
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
function tokenizeSql(sqlText: string): Token[] {
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

function significantTokens(tokens: Token[]): Token[] {
  const semicolons = tokens.filter((token) => token.kind === "semicolon");
  if (
    semicolons.length > 1 ||
    (semicolons.length === 1 && tokens.at(-1) !== semicolons[0])
  ) {
    throw new Error("A query deve conter somente uma instrução SQL.");
  }
  return semicolons.length ? tokens.slice(0, -1) : tokens;
}

export class QueryInputValidationError extends Error {
  constructor(
    public readonly code:
      | "INVALID_SQL"
      | "INVALID_PARAMETERS"
      | "MISSING_PARAMETERS",
    message: string,
  ) {
    super(message);
    this.name = "QueryInputValidationError";
  }
}

const TYPE_LITERAL_BOUNDARY_WORDS = new Set([
  "and",
  "as",
  "between",
  "case",
  "distinct",
  "else",
  "from",
  "having",
  "ilike",
  "in",
  "is",
  "like",
  "limit",
  "not",
  "offset",
  "on",
  "or",
  "returning",
  "select",
  "similar",
  "then",
  "values",
  "when",
  "where",
]);

function normalizeTypeToken(token: Token | undefined): string | undefined {
  if (!token || (token.kind !== "word" && token.kind !== "quoted_identifier"))
    return undefined;
  return token.kind === "word"
    ? token.value.toLocaleLowerCase("en-US")
    : token.value;
}

/** Parses one approved built-in type prefix and returns the token after its array suffixes. */
function parseSafeTypePrefix(
  tokens: Token[],
  start: number,
): number | undefined {
  let cursor = start;
  const first = normalizeTypeToken(tokens[cursor]);
  if (!first) return undefined;

  if (tokens[cursor + 1]?.value === ".") {
    if (first !== "pg_catalog") return undefined;
    cursor += 2;
  }

  const typeWords: string[] = [];
  const maxWords = Math.max(
    ...SAFE_TYPE_NAMES.map((name) => name.split(" ").length),
  );
  while (typeWords.length < maxWords) {
    const value = normalizeTypeToken(tokens[cursor + typeWords.length]);
    if (!value) break;
    typeWords.push(value);
  }

  let typeName: string | undefined;
  let typeNameLength = 0;
  for (const candidate of SAFE_TYPE_NAMES) {
    const parts = candidate.split(" ");
    if (
      parts.length <= typeWords.length &&
      parts.every((part, index) => part === typeWords[index])
    ) {
      typeName = candidate;
      typeNameLength = parts.length;
      break;
    }
  }
  if (!typeName) return undefined;
  cursor += typeNameLength;

  if (tokens[cursor]?.value === "(" && SAFE_TYPE_MODIFIER_NAMES.has(typeName)) {
    cursor += 1;
    let modifierCount = 0;
    while (true) {
      const number = tokens[cursor];
      if (number?.kind !== "number" || number.value.length > 4)
        return undefined;
      modifierCount += 1;
      cursor += 1;
      if (tokens[cursor]?.value !== ",") break;
      if (modifierCount >= 2) return undefined;
      cursor += 1;
    }
    if (tokens[cursor]?.value !== ")") return undefined;
    cursor += 1;
  }

  if (typeName === "time" || typeName === "timestamp") {
    if (
      tokens[cursor]?.value === "with" &&
      tokens[cursor + 1]?.value === "time" &&
      tokens[cursor + 2]?.value === "zone"
    ) {
      cursor += 3;
    } else if (
      tokens[cursor]?.value === "without" &&
      tokens[cursor + 1]?.value === "time" &&
      tokens[cursor + 2]?.value === "zone"
    ) {
      cursor += 3;
    }
  }

  if (typeName === "interval") {
    if (tokens[cursor]?.value === "(") {
      cursor += 1;
      const precision = tokens[cursor];
      if (precision?.kind !== "number" || precision.value.length > 4)
        return undefined;
      cursor += 1;
      if (tokens[cursor]?.value !== ")") return undefined;
      cursor += 1;
    }
    const startField = tokens[cursor]?.value;
    if (
      ["year", "month", "day", "hour", "minute", "second"].includes(
        startField ?? "",
      )
    ) {
      cursor += 1;
      if (startField === "second" && tokens[cursor]?.value === "(") {
        cursor += 1;
        const precision = tokens[cursor];
        if (precision?.kind !== "number" || precision.value.length > 4)
          return undefined;
        cursor += 1;
        if (tokens[cursor]?.value !== ")") return undefined;
        cursor += 1;
      }
      if (tokens[cursor]?.value === "to") {
        cursor += 1;
        const endField = tokens[cursor]?.value;
        if (
          !["month", "day", "hour", "minute", "second"].includes(endField ?? "")
        )
          return undefined;
        cursor += 1;
        if (endField === "second" && tokens[cursor]?.value === "(") {
          cursor += 1;
          const precision = tokens[cursor];
          if (precision?.kind !== "number" || precision.value.length > 4)
            return undefined;
          cursor += 1;
          if (tokens[cursor]?.value !== ")") return undefined;
          cursor += 1;
        }
      }
    }
  }

  while (true) {
    if (tokens[cursor]?.value === "array") cursor += 1;
    if (tokens[cursor]?.value !== "[") break;
    cursor += 1;
    if (tokens[cursor]?.kind === "number") cursor += 1;
    if (tokens[cursor]?.value !== "]") return undefined;
    cursor += 1;
  }
  return cursor;
}

function isTypeLiteralBoundary(token: Token | undefined): boolean {
  if (!token) return true;
  if (token.kind === "operator" || token.kind === "parameter") return true;
  if (token.kind === "punctuation")
    return ["(", ",", "["].includes(token.value);
  return token.kind === "word" && TYPE_LITERAL_BOUNDARY_WORDS.has(token.value);
}

function isTypeLikeSequence(
  tokens: Token[],
  start: number,
  end: number,
): boolean {
  if (start >= end) return false;
  for (const token of tokens.slice(start, end)) {
    if (
      token.kind === "word" ||
      token.kind === "quoted_identifier" ||
      token.kind === "number"
    )
      continue;
    if (
      token.kind === "punctuation" &&
      [".", "(", ")", ",", "[", "]"].includes(token.value)
    )
      continue;
    return false;
  }
  return true;
}

function assertAiCastTypes(tokens: Token[]): void {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (
      token.kind === "word" &&
      token.value === "cast" &&
      tokens[index + 1]?.value === "("
    ) {
      const castOpen = index + 1;
      let depth = 1;
      let castClose = castOpen + 1;
      while (castClose < tokens.length && depth > 0) {
        if (tokens[castClose]?.value === "(") depth += 1;
        else if (tokens[castClose]?.value === ")") depth -= 1;
        if (depth > 0) castClose += 1;
      }
      if (depth !== 0)
        throw new QueryInputValidationError("INVALID_SQL", "CAST incompleto.");
      let nestedDepth = 0;
      let asIndex = -1;
      for (let cursor = castOpen + 1; cursor < castClose; cursor += 1) {
        if (tokens[cursor]?.value === "(") nestedDepth += 1;
        else if (tokens[cursor]?.value === ")") nestedDepth -= 1;
        else if (
          nestedDepth === 0 &&
          tokens[cursor]?.kind === "word" &&
          tokens[cursor]?.value === "as"
        ) {
          asIndex = cursor;
          break;
        }
      }
      if (asIndex < 0 || parseSafeTypePrefix(tokens, asIndex + 1) !== castClose)
        throw new QueryInputValidationError(
          "INVALID_SQL",
          "CAST só pode converter para tipos PostgreSQL built-in aprovados.",
        );
    }

    if (token.kind === "operator" && token.value === "::") {
      if (!parseSafeTypePrefix(tokens, index + 1))
        throw new QueryInputValidationError(
          "INVALID_SQL",
          "Casts PostgreSQL só podem usar tipos built-in aprovados.",
        );
    }

    if (token.kind !== "string") continue;
    if (
      tokens[index - 1]?.value === "zone" &&
      tokens[index - 2]?.value === "time" &&
      tokens[index - 3]?.value === "at"
    )
      continue;
    if (
      tokens[index - 1]?.kind === "word" &&
      TYPE_LITERAL_BOUNDARY_WORDS.has(tokens[index - 1]!.value)
    )
      continue;
    if (
      tokens[index - 1]?.kind !== "word" &&
      tokens[index - 1]?.kind !== "quoted_identifier" &&
      ![")", "]"].includes(tokens[index - 1]?.value ?? "")
    )
      continue;
    const minimumStart = Math.max(0, index - 12);
    let candidateStart = index - 1;
    while (
      candidateStart >= minimumStart &&
      isTypeLikeSequence(tokens, candidateStart, index) &&
      !(
        tokens[candidateStart]?.kind === "word" &&
        TYPE_LITERAL_BOUNDARY_WORDS.has(tokens[candidateStart]!.value)
      ) &&
      !isTypeLiteralBoundary(tokens[candidateStart - 1])
    ) {
      candidateStart -= 1;
    }
    if (
      candidateStart < index &&
      isTypeLikeSequence(tokens, candidateStart, index) &&
      isTypeLiteralBoundary(tokens[candidateStart - 1])
    ) {
      const safeTypeEnd = parseSafeTypePrefix(tokens, candidateStart);
      if (safeTypeEnd !== index)
        throw new QueryInputValidationError(
          "INVALID_SQL",
          "Literais tipados só podem usar tipos PostgreSQL built-in aprovados.",
        );
    }
  }
}

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

/** Applies the stricter function and namespace policy only to SQL executed by the AI preview tool. */
export function assertAiReadOnlySql(sqlText: string): void {
  assertReadOnlySql(sqlText);
  const tokens = significantTokens(tokenizeSql(sqlText));
  assertAiCastTypes(tokens);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind !== "word" && token.kind !== "quoted_identifier") continue;
    if (isAliasColumnList(tokens, index)) continue;
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

function normalizeIdentifier(token: Token): string {
  return token.kind === "word"
    ? token.value.toLocaleLowerCase("en-US")
    : token.value;
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
  const finalTerminator = tokenizeSql(sqlText).find(
    (token) => token.kind === "semicolon",
  );
  return (
    finalTerminator ? sqlText.slice(0, finalTerminator.start) : sqlText
  ).trim();
}

export function assertParameterDefinitions(
  parameters: ParameterDefinition[],
): void {
  if (parameters.length > MAX_PARAMETERS)
    throw new QueryInputValidationError(
      "INVALID_PARAMETERS",
      `O máximo é ${MAX_PARAMETERS} parâmetros por query.`,
    );
  const names = new Set<string>();
  for (const parameter of parameters) {
    if (names.has(parameter.name))
      throw new QueryInputValidationError(
        "INVALID_PARAMETERS",
        "Os nomes dos parâmetros devem ser únicos.",
      );
    names.add(parameter.name);
  }
}

export function assertSqlParameters(
  sqlText: string,
  definitions: ParameterDefinition[],
): void {
  const declared = new Set(definitions.map((definition) => definition.name));
  const used = new Set(
    tokenizeSql(sqlText)
      .filter((token) => token.kind === "parameter")
      .map((token) => token.value),
  );
  for (const name of used) {
    if (!declared.has(name))
      throw new QueryInputValidationError(
        "INVALID_PARAMETERS",
        `O parâmetro '${name}' usado no SQL não foi declarado.`,
      );
  }
  for (const name of declared) {
    if (!used.has(name))
      throw new QueryInputValidationError(
        "INVALID_PARAMETERS",
        `O parâmetro '${name}' foi declarado, mas não é utilizado no SQL.`,
      );
  }
}

export function bindQueryParameters(
  sqlText: string,
  definitions: ParameterDefinition[],
  values: Record<string, string | string[] | undefined>,
): { sqlText: string; values: unknown[] } {
  const declared = new Map(
    definitions.map((definition) => [definition.name, definition]),
  );
  for (const key of Object.keys(values)) {
    if (!declared.has(key))
      throw new QueryInputValidationError(
        "INVALID_PARAMETERS",
        `O parâmetro '${key}' não foi declarado para esta query.`,
      );
  }

  const tokens = tokenizeSql(sqlText).filter(
    (token) => token.kind === "parameter",
  );
  const boundValues: unknown[] = [];
  const placeholders = new Map<string, number>();
  let totalCharacters = 0;
  let rewritten = "";
  let currentIndex = 0;
  for (const token of tokens) {
    rewritten += sqlText.slice(currentIndex, token.start);
    const definition = declared.get(token.value);
    if (!definition)
      throw new QueryInputValidationError(
        "INVALID_PARAMETERS",
        `O parâmetro '${token.value}' usado no SQL não foi declarado.`,
      );
    if (!placeholders.has(token.value)) {
      const rawValue = values[token.value];
      if (
        definition.required &&
        (rawValue === undefined || rawValue.length === 0)
      ) {
        throw new QueryInputValidationError(
          "MISSING_PARAMETERS",
          `Informe o parâmetro obrigatório '${definition.label}' antes de testar a query.`,
        );
      }
      const normalized = normalizeParameter(definition, rawValue);
      totalCharacters += Array.isArray(normalized)
        ? normalized.reduce((total, value) => total + value.length, 0)
        : String(normalized ?? "").length;
      if (totalCharacters > MAX_PARAMETER_TOTAL_CHARACTERS)
        throw new QueryInputValidationError(
          "INVALID_PARAMETERS",
          "Os valores dos parâmetros excedem o tamanho máximo permitido.",
        );
      boundValues.push(normalized);
      placeholders.set(token.value, boundValues.length);
    }
    rewritten += `$${placeholders.get(token.value)}`;
    currentIndex = token.end;
  }
  rewritten += sqlText.slice(currentIndex);
  return { sqlText: rewritten, values: boundValues };
}

function normalizeParameter(
  definition: ParameterDefinition,
  rawValue: string | string[] | undefined,
): string | number | boolean | string[] | null {
  if (rawValue === undefined || rawValue.length === 0) return null;
  const inputValues = Array.isArray(rawValue) ? rawValue : [rawValue];
  if (
    inputValues.length > MAX_PARAMETER_ARRAY_ITEMS ||
    inputValues.some((value) => value.length > MAX_PARAMETER_VALUE_CHARACTERS)
  ) {
    throw new QueryInputValidationError(
      "INVALID_PARAMETERS",
      `O parâmetro '${definition.label}' excede os limites de tamanho permitidos.`,
    );
  }
  if (definition.type === "multi_select") {
    if (!Array.isArray(rawValue)) return [rawValue];
    return [...rawValue];
  }
  if (Array.isArray(rawValue))
    throw new QueryInputValidationError(
      "INVALID_PARAMETERS",
      `O parâmetro '${definition.label}' aceita somente um valor.`,
    );
  if (definition.type === "number") {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(rawValue))
      throw new QueryInputValidationError(
        "INVALID_PARAMETERS",
        `O parâmetro '${definition.label}' deve ser numérico.`,
      );
    const numberValue = Number(rawValue);
    if (!Number.isFinite(numberValue))
      throw new QueryInputValidationError(
        "INVALID_PARAMETERS",
        `O parâmetro '${definition.label}' deve ser numérico.`,
      );
    return numberValue;
  }
  if (definition.type === "boolean") {
    if (rawValue !== "true" && rawValue !== "false")
      throw new QueryInputValidationError(
        "INVALID_PARAMETERS",
        `O parâmetro '${definition.label}' deve ser verdadeiro ou falso.`,
      );
    return rawValue === "true";
  }
  if (definition.type === "date") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawValue);
    if (!match)
      throw new QueryInputValidationError(
        "INVALID_PARAMETERS",
        `O parâmetro '${definition.label}' deve estar no formato AAAA-MM-DD.`,
      );
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const daysInMonth =
      month === 2
        ? isLeapYear(year)
          ? 29
          : 28
        : [4, 6, 9, 11].includes(month)
          ? 30
          : 31;
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth)
      throw new QueryInputValidationError(
        "INVALID_PARAMETERS",
        `O parâmetro '${definition.label}' deve ser uma data válida no calendário.`,
      );
  }
  return rawValue;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
