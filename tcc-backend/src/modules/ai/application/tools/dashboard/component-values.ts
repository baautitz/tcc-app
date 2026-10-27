import { z } from "zod";
import { parameterDefinitionSchema } from "../../../../../shared/lib/contracts.js";
import {
  AI_QUERY_MAX_BYTES,
  AI_QUERY_MAX_ROWS,
} from "../../../../data-sources/domain/external-source.js";
import {
  aiComponentSchema,
  aiDashboardProposalInputSchema,
  createDashboardDocument,
} from "../../../../dashboards/domain/dashboard-proposals.js";
import { validateDashboardPreviewFields } from "../../../../dashboards/domain/dashboard-preview-validation.js";
import type {
  AiDashboardQueryDefinition,
  AiDashboardQueryPreview,
  AiDashboardToolsRepository,
} from "./dashboard-types.js";

export type FilterValue = string | string[];
export type FilterValues = Record<string, FilterValue>;
/** Ligação parâmetro da query -> nome do filtro do dashboard. */
export type ParameterBindings = Record<string, string>;

/** Valores vindos do cliente: dados não confiáveis, sempre com limites. */
export const filterValuesSchema = z.record(
  z.string().max(80),
  z.union([z.string().max(2048), z.array(z.string().max(2048)).max(50)]),
);
export const parameterBindingsSchema = z.record(
  z.string().max(80),
  z.string().max(80),
);

/** Nomes dos parâmetros de uma lista de definições de query (formato não confiável). */
export function parameterNamesOf(definitions: unknown): string[] {
  if (!Array.isArray(definitions)) return [];
  return definitions.flatMap((definition: unknown) =>
    definition && typeof (definition as { name?: unknown }).name === "string"
      ? [(definition as { name: string }).name]
      : [],
  );
}

export function isBlank(value: FilterValue | undefined) {
  return (
    value === undefined ||
    (Array.isArray(value) ? value.length === 0 : value.trim().length === 0)
  );
}

/**
 * Valores por parâmetro da query: os ligados leem o valor do filtro; os demais
 * usam o valor do próprio parâmetro. Vazios são omitidos.
 */
export function resolveParameterValues(
  parameterNames: string[],
  bindings: ParameterBindings,
  contextValues: FilterValues,
  parameterValues: FilterValues,
): FilterValues {
  const values: FilterValues = {};
  for (const name of parameterNames) {
    const filter = bindings[name];
    const value = filter
      ? Object.hasOwn(contextValues, filter)
        ? contextValues[filter]
        : undefined
      : Object.hasOwn(parameterValues, name)
        ? parameterValues[name]
        : undefined;
    if (value !== undefined && !isBlank(value)) values[name] = value;
  }
  return values;
}

/** Inverso: separa valores por parâmetro (como a IA os informa) em filtro e parâmetro. */
export function splitParameterValues(
  parameterNames: string[],
  bindings: ParameterBindings,
  values: FilterValues,
) {
  const contextValues: FilterValues = {};
  const parameterValues: FilterValues = {};
  for (const name of parameterNames) {
    const value = values[name];
    if (value === undefined || isBlank(value)) continue;
    const filter = bindings[name];
    if (filter) contextValues[filter] = value;
    else parameterValues[name] = value;
  }
  return { contextValues, parameterValues };
}

/** Parâmetros da query com tipo, ligação e valor, para o cartão montar os inputs. */
export function describePreviewParameters(
  definitions: unknown,
  bindings: ParameterBindings,
  values: FilterValues,
) {
  if (!Array.isArray(definitions)) return [];
  return definitions.flatMap((definition) => {
    if (!definition || typeof definition !== "object") return [];
    const { name, label, required, type } = definition as Record<
      string,
      unknown
    >;
    if (typeof name !== "string") return [];
    return [
      {
        name,
        label: typeof label === "string" ? label : name,
        type: parameterDefinitionSchema.shape.type.catch("text").parse(type),
        required: required !== false,
        bound: Object.hasOwn(bindings, name) ? bindings[name]! : null,
        value: values[name] ?? null,
      },
    ];
  });
}

/** Documento mínimo só com o componente, para reusar a validação da prévia. */
function isolatedDocument(component: z.infer<typeof aiComponentSchema>) {
  return createDashboardDocument(
    aiDashboardProposalInputSchema.parse({
      mode: "create",
      name: "Componente isolado",
      components: [component],
    }),
    crypto.randomUUID(),
  );
}

/** Executa a query do componente com os valores e valida os campos do componente. */
export async function runComponentPreview(
  repository: Pick<AiDashboardToolsRepository, "runPreview">,
  component: z.infer<typeof aiComponentSchema>,
  query: AiDashboardQueryDefinition,
  values: FilterValues,
) {
  let preview: AiDashboardQueryPreview;
  try {
    preview = await repository.runPreview(query, values);
  } catch (error) {
    preview = {
      rows: [],
      rowLimit: AI_QUERY_MAX_ROWS,
      byteLimit: AI_QUERY_MAX_BYTES,
      bytes: 0,
      truncated: false,
      truncationReason: null,
      error:
        error instanceof Error
          ? error.message.slice(0, 400)
          : "A consulta falhou durante a prévia.",
    };
  }
  const issues = preview.error
    ? [preview.error]
    : validateDashboardPreviewFields(
        isolatedDocument(component),
        { [component.queryUuid]: preview },
        undefined,
        new Set(),
      );
  return { preview, issues };
}
