import {
  drizzleDashboardSyncRepository,
  type DashboardSyncRepository,
} from "../repositories/dashboard-sync-repository.js";
import {
  dashboardDefinitionSchema,
  parameterDefinitionSchema,
  type DashboardDefinition,
  type ParameterDefinition,
} from "../shared/lib/contracts.js";
import {
  getRegisteredDashboards,
  type DashboardDocument,
} from "./dashboards.js";

type JsonRecord = Record<string, unknown>;
export type DashboardQueryMetadata = { id: string; parameters: unknown };

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function dashboardQueryReferences(
  dashboard: DashboardDocument,
): Set<string> {
  const references = new Set<string>();
  for (const component of dashboard.ui.components) {
    const queryUuid = record(component.props).queryUuid;
    if (typeof queryUuid === "string" && queryUuid.length > 0)
      references.add(queryUuid);
  }
  dashboard.queryBindings.forEach((binding) =>
    references.add(binding.queryUuid),
  );
  dashboard.workspace.params.forEach((argument) => {
    if (argument.lookup) references.add(argument.lookup.queryUuid);
  });
  return references;
}

function queryParameters(
  query: DashboardQueryMetadata,
  dashboardId: string,
): ParameterDefinition[] {
  try {
    return zParameters.parse(query.parameters);
  } catch {
    throw new Error(
      `A query '${query.id}' referenciada pela dashboard '${dashboardId}' possui parâmetros inválidos.`,
    );
  }
}

const zParameters = parameterDefinitionSchema.array();

function validateQueryBindings(
  dashboard: DashboardDocument,
  queriesById: Map<string, DashboardQueryMetadata>,
): void {
  const argumentsByName = new Map(
    dashboard.workspace.params.map((argument) => [argument.name, argument]),
  );
  const boundParameters = new Map<string, Set<string>>();

  for (const [index, binding] of dashboard.queryBindings.entries()) {
    const query = queriesById.get(binding.queryUuid);
    if (!query)
      throw new Error(
        `A query '${binding.queryUuid}' referenciada pela dashboard '${dashboard.id}' não existe no catálogo.`,
      );
    const parameters = queryParameters(query, dashboard.id);
    const parametersByName = new Map(
      parameters.map((parameter) => [parameter.name, parameter]),
    );
    for (const [queryParameterName, source] of Object.entries(
      binding.parameters,
    )) {
      const parameter = parametersByName.get(queryParameterName);
      if (!parameter) {
        throw new Error(
          `O parâmetro '${queryParameterName}' não foi declarado pela query '${query.id}'.`,
        );
      }
      if (source.source === "context") {
        const argument = argumentsByName.get(source.argument);
        if (!argument) {
          throw new Error(
            `O argumento '${source.argument}' do mapeamento ${index + 1} não existe na dashboard '${dashboard.id}'.`,
          );
        }
        if (argument.type !== parameter.type) {
          throw new Error(
            `O argumento '${source.argument}' (${argument.type}) não é compatível com o parâmetro '${queryParameterName}' (${parameter.type}) da query '${query.id}'.`,
          );
        }
        if (parameter.required && !argument.required) {
          throw new Error(
            `O parâmetro obrigatório '${queryParameterName}' da query '${query.id}' exige que o argumento '${source.argument}' seja obrigatório na dashboard.`,
          );
        }
      } else {
        const value = source.value;
        const hasValue = Array.isArray(value)
          ? value.length > 0
          : value.trim().length > 0;
        if (parameter.required && !hasValue) {
          throw new Error(
            `O parâmetro obrigatório '${queryParameterName}' da query '${query.id}' precisa de um valor manual.`,
          );
        }
        if (parameter.type === "multi_select" && !Array.isArray(value)) {
          throw new Error(
            `O parâmetro '${queryParameterName}' da query '${query.id}' exige uma lista de valores manuais.`,
          );
        }
        if (parameter.type !== "multi_select" && Array.isArray(value)) {
          throw new Error(
            `O parâmetro '${queryParameterName}' da query '${query.id}' aceita um único valor manual.`,
          );
        }
        if (
          parameter.type === "number" &&
          typeof value === "string" &&
          value.trim() &&
          !Number.isFinite(Number(value))
        ) {
          throw new Error(
            `O valor manual de '${queryParameterName}' da query '${query.id}' deve ser numérico.`,
          );
        }
        if (
          parameter.type === "boolean" &&
          value !== "true" &&
          value !== "false"
        ) {
          throw new Error(
            `O valor manual de '${queryParameterName}' da query '${query.id}' deve ser true ou false.`,
          );
        }
        if (
          parameter.type === "date" &&
          typeof value === "string" &&
          value &&
          !/^\d{4}-\d{2}-\d{2}$/.test(value)
        ) {
          throw new Error(
            `O valor manual de '${queryParameterName}' da query '${query.id}' deve estar no formato AAAA-MM-DD.`,
          );
        }
      }
      const bound = boundParameters.get(query.id) ?? new Set<string>();
      bound.add(queryParameterName);
      boundParameters.set(query.id, bound);
    }
  }

  for (const queryId of dashboardQueryReferences(dashboard)) {
    const query = queriesById.get(queryId);
    if (!query)
      throw new Error(
        `A query '${queryId}' referenciada pela dashboard '${dashboard.id}' não existe no catálogo.`,
      );
  }

  for (const query of queriesById.values()) {
    const parameters = queryParameters(query, dashboard.id);
    const bound = boundParameters.get(query.id) ?? new Set<string>();
    for (const parameter of parameters) {
      if (parameter.required && !bound.has(parameter.name)) {
        throw new Error(
          `O parâmetro obrigatório '${parameter.name}' da query '${query.id}' não está mapeado na dashboard '${dashboard.id}'.`,
        );
      }
    }
  }
}

export function buildDashboardDefinitionFromDocument(
  dashboard: DashboardDocument,
  catalogQueries: DashboardQueryMetadata[],
  options: { validateCatalog?: boolean } = {},
): DashboardDefinition {
  const validateCatalog = options.validateCatalog ?? true;
  for (const argument of dashboard.workspace.params) {
    if (argument.lookup && !argument.lookup.queryUuid) {
      throw new Error(
        `O argumento '${argument.name}' está sem uma query de opções selecionada.`,
      );
    }
  }
  const references = dashboardQueryReferences(dashboard);
  const queriesById = new Map(catalogQueries.map((query) => [query.id, query]));
  if (validateCatalog) {
    for (const queryId of references) {
      if (!queriesById.has(queryId)) {
        throw new Error(
          `A query '${queryId}' referenciada pela dashboard '${dashboard.id}' não existe no catálogo.`,
        );
      }
    }
    validateQueryBindings(dashboard, queriesById);
  }

  const layout = record(dashboard.ui.layout);
  const components = dashboard.ui.components.map((component) => {
    const props = record(component.props);
    const queryUuid = text(props.queryUuid, "");
    if (!queryUuid)
      throw new Error(
        `O componente '${component.id}' da dashboard '${dashboard.id}' não informa queryUuid.`,
      );
    const { queryUuid: _queryUuid, ...componentProps } = props;
    const rawLayout = record(component.layoutProps);
    return {
      id: component.id,
      type: component.component,
      title: text(props.title, component.id),
      queryUuid,
      layoutProps: {
        colSpan: Number(rawLayout.colSpan) || 12,
        rowSpan: Number(rawLayout.rowSpan) || 1,
      },
      props: componentProps,
    };
  });

  return dashboardDefinitionSchema.parse({
    layout: { columns: 12, gap: Number(layout.gap) || 16 },
    workspace: { params: dashboard.workspace.params },
    queryBindings: dashboard.queryBindings,
    components,
  });
}

export async function validateDashboardCatalog(
  repo: DashboardSyncRepository = drizzleDashboardSyncRepository,
): Promise<{
  dashboards: number;
  queries: number;
}> {
  const dashboards = await getRegisteredDashboards();
  const referencedIds = new Set<string>();
  const catalog = await repo.listQueryCatalog();

  for (const dashboard of dashboards) {
    const queryIds = [...dashboardQueryReferences(dashboard)];
    queryIds.forEach((id) => referencedIds.add(id));
    const queryRows = catalog.filter((query) => queryIds.includes(query.id));
    buildDashboardDefinitionFromDocument(dashboard, queryRows);
  }

  return { dashboards: dashboards.length, queries: referencedIds.size };
}
