import type { DashboardDocument, DashboardDocumentComponent } from "@/modules/dashboards/model/types";
import type { QuerySummary } from "@/modules/queries/model/types";

export function componentQuery(component: DashboardDocumentComponent): string {
  return typeof component.props.queryUuid === "string" ? component.props.queryUuid : "";
}

export function dashboardValidationIssues(dashboard: DashboardDocument, queries: QuerySummary[]): string[] {
  const queriesById = new Map(queries.map((query) => [query.id, query]));
  const argumentsByName = new Map(dashboard.workspace.params.map((argument) => [argument.name, argument]));
  const issues = new Set<string>();
  const checkQuery = (queryId: string, owner: string) => {
    if (!queryId) issues.add(`${owner} não tem uma query selecionada.`);
    else if (!queriesById.has(queryId)) issues.add(`${owner} referencia uma query que não existe no catálogo.`);
  };

  for (const component of dashboard.ui.components) {
    const title = String(component.props.title ?? component.id);
    checkQuery(componentQuery(component), `O componente "${title}"`);
  }
  for (const argument of dashboard.workspace.params) {
    if (argument.lookup) checkQuery(argument.lookup.queryUuid, `A query de opções do argumento "${argument.label}"`);
  }

  const referencedQueryIds = new Set<string>();
  dashboard.ui.components.forEach((component) => {
    const queryId = componentQuery(component);
    if (queryId) referencedQueryIds.add(queryId);
  });
  dashboard.workspace.params.forEach((argument) => {
    if (argument.lookup?.queryUuid) referencedQueryIds.add(argument.lookup.queryUuid);
  });
  dashboard.queryBindings.forEach((binding) => {
    if (binding.queryUuid) referencedQueryIds.add(binding.queryUuid);
  });

  const bindingsByQuery = new Map(dashboard.queryBindings.map((binding) => [binding.queryUuid, binding]));
  for (const binding of dashboard.queryBindings) {
    const query = queriesById.get(binding.queryUuid);
    if (!query) {
      checkQuery(binding.queryUuid, "O mapeamento de parâmetros");
      continue;
    }
    const parametersByName = new Map(query.parameters.map((parameter) => [parameter.name, parameter]));
    for (const [parameterName, source] of Object.entries(binding.parameters)) {
      const parameter = parametersByName.get(parameterName);
      if (!parameter) {
        issues.add(`O mapeamento "${parameterName}" não foi declarado pela query "${query.name}".`);
        continue;
      }
      if (source.source === "context") {
        const argument = argumentsByName.get(source.argument);
        if (!argument) issues.add(`O argumento "${source.argument}" não existe na dashboard.`);
        else if (argument.type !== parameter.type) issues.add(`O argumento "${argument.label}" não é compatível com o parâmetro "${parameter.label}" da query "${query.name}".`);
        else if (parameter.required && !argument.required) issues.add(`O parâmetro obrigatório "${parameter.label}" exige um argumento obrigatório na dashboard.`);
      } else {
        const value = source.value;
        const hasValue = Array.isArray(value) ? value.length > 0 : value.trim().length > 0;
        if (parameter.required && !hasValue) issues.add(`O parâmetro obrigatório "${parameter.label}" da query "${query.name}" precisa de um valor.`);
        if (parameter.type === "multi_select" && !Array.isArray(value)) issues.add(`O parâmetro "${parameter.label}" da query "${query.name}" precisa de uma lista de valores.`);
        if (parameter.type !== "multi_select" && Array.isArray(value)) issues.add(`O parâmetro "${parameter.label}" da query "${query.name}" aceita um único valor.`);
        if (parameter.type === "number" && typeof value === "string" && value.trim() && !Number.isFinite(Number(value))) issues.add(`O valor do parâmetro "${parameter.label}" da query "${query.name}" precisa ser numérico.`);
        if (parameter.type === "boolean" && value !== "true" && value !== "false") issues.add(`O valor do parâmetro "${parameter.label}" da query "${query.name}" precisa ser verdadeiro ou falso.`);
        if (parameter.type === "date" && typeof value === "string" && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) issues.add(`O valor do parâmetro "${parameter.label}" da query "${query.name}" precisa estar no formato AAAA-MM-DD.`);
      }
    }
  }

  for (const queryId of referencedQueryIds) {
    const query = queriesById.get(queryId);
    if (!query) continue;
    const binding = bindingsByQuery.get(queryId);
    for (const parameter of query.parameters) {
      if (parameter.required && !binding?.parameters[parameter.name]) {
        issues.add(`O parâmetro obrigatório "${parameter.label}" da query "${query.name}" não está mapeado.`);
      }
    }
  }

  return [...issues];
}
