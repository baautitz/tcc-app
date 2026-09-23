import type { ParameterDefinition } from "../lib/contracts.js";

const FORBIDDEN_SQL = /\b(?:insert|update|delete|merge|drop|alter|create|grant|revoke|truncate|copy|call|do|execute|vacuum|analyze|set|show|listen|notify)\b/i;

export function assertReadOnlySql(sqlText: string): void {
  const normalized = sqlText.trim();
  const withoutTrailingSemicolon = normalized.replace(/;\s*$/, "");
  if (!/^(?:select|with)\b/i.test(withoutTrailingSemicolon)) {
    throw new Error("A query deve começar com SELECT ou WITH.");
  }
  if (withoutTrailingSemicolon.includes(";")) {
    throw new Error("A query deve conter somente uma instrução SQL.");
  }
  if (FORBIDDEN_SQL.test(withoutTrailingSemicolon)) {
    throw new Error("A query contém uma operação não permitida. Somente SELECT é aceito.");
  }
}

export function assertParameterDefinitions(parameters: ParameterDefinition[]): void {
  const names = new Set<string>();
  for (const parameter of parameters) {
    if (names.has(parameter.name)) throw new Error("Os nomes dos parâmetros devem ser únicos.");
    names.add(parameter.name);
  }
}

export function bindQueryParameters(
  sqlText: string,
  definitions: ParameterDefinition[],
  values: Record<string, string | string[] | undefined>,
): { sqlText: string; values: unknown[] } {
  const declared = new Map(definitions.map((definition) => [definition.name, definition]));
  for (const key of Object.keys(values)) {
    if (!declared.has(key)) throw new Error(`O parâmetro '${key}' não foi declarado para esta query.`);
  }

  const boundValues: unknown[] = [];
  const placeholders = new Map<string, number>();
  const sqlWithParameters = sqlText.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (_, name: string) => {
    const definition = declared.get(name);
    if (!definition) throw new Error(`O parâmetro '${name}' usado no SQL não foi declarado.`);
    if (!placeholders.has(name)) {
      const rawValue = values[name];
      if (definition.required && (rawValue === undefined || rawValue.length === 0)) {
        throw new Error(`O parâmetro '${definition.label}' é obrigatório.`);
      }
      boundValues.push(normalizeParameter(definition, rawValue));
      placeholders.set(name, boundValues.length);
    }
    return `$${placeholders.get(name)}`;
  });

  return { sqlText: sqlWithParameters, values: boundValues };
}

function normalizeParameter(definition: ParameterDefinition, rawValue: string | string[] | undefined): string | number | boolean | string[] | null {
  if (rawValue === undefined || rawValue.length === 0) return null;
  if (definition.type === "multi_select") return Array.isArray(rawValue) ? rawValue : [rawValue];
  if (Array.isArray(rawValue)) throw new Error(`O parâmetro '${definition.label}' aceita somente um valor.`);
  if (definition.type === "number") {
    const numberValue = Number(rawValue);
    if (!Number.isFinite(numberValue)) throw new Error(`O parâmetro '${definition.label}' deve ser numérico.`);
    return numberValue;
  }
  if (definition.type === "boolean") {
    if (rawValue !== "true" && rawValue !== "false") throw new Error(`O parâmetro '${definition.label}' deve ser verdadeiro ou falso.`);
    return rawValue === "true";
  }
  if (definition.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    throw new Error(`O parâmetro '${definition.label}' deve estar no formato AAAA-MM-DD.`);
  }
  return rawValue;
}
