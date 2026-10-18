import type { ParameterDefinition } from "../lib/contracts.js";
import { QueryInputValidationError, tokenizeSql } from "./sql-lexer.js";

const MAX_PARAMETERS = 50;
const MAX_PARAMETER_VALUE_CHARACTERS = 2_048;
const MAX_PARAMETER_ARRAY_ITEMS = 50;
const MAX_PARAMETER_TOTAL_CHARACTERS = 16_384;

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
  // An unselected optional multi-select means “all values”, represented as
  // an empty array. Binding NULL makes common CARDINALITY/ANY filter clauses
  // evaluate to NULL and can silently turn an aggregate into zero.
  if (
    definition.type === "multi_select" &&
    !definition.required &&
    (rawValue === undefined || rawValue.length === 0)
  ) {
    return [];
  }
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
