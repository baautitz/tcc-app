import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { dashboards, dataSources, permissions, savedQueries } from "../db/schema.js";
import { dashboardDefinitionSchema, parameterDefinitionSchema, type DashboardDefinition, type ParameterDefinition } from "../lib/contracts.js";
import { createResourcePermission, grantPermissionKeys } from "./permissions.js";
import { getPersistedRecipes, type RecipeDocument } from "./recipes.js";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function stableUuid(seed: string): string {
  const hex = createHash("sha1").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function recipeParameters(recipe: RecipeDocument): ParameterDefinition[] {
  const workspace = record(recipe.workspace);
  const params = Array.isArray(workspace.params) ? workspace.params : [];
  return params.flatMap((value) => {
    try {
      return [parameterDefinitionSchema.parse(value)];
    } catch {
      return [];
    }
  });
}

function normalizeSql(sql: string): string {
  return sql.replace(/\{\{workspace\.([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, "{{$1}}");
}

function recipeQueries(recipe: RecipeDocument, sourceMap: Map<string, string>) {
  const sources = record(recipe.sources);
  const queries: Array<{
    id: string;
    key: string;
    dashboardId: string;
    dataSourceId: string;
    name: string;
    sqlText: string;
    parameters: ParameterDefinition[];
    requiredPermissionKeys: string[];
  }> = [];

  for (const [sourceName, sourceValue] of Object.entries(sources)) {
    const source = record(sourceValue);
    const sourceId = sourceMap.get(sourceName);
    if (!sourceId) throw new Error(`A recipe '${recipe.id}' exige o servidor '${sourceName}'.`);
    const sourceQueries = record(source.queries);
    for (const [queryName, queryValue] of Object.entries(sourceQueries)) {
      const query = record(queryValue);
      const options = Array.isArray(query.options) ? query.options.map(record) : [];
      const option = options[0] ?? query;
      const sqlText = typeof option.sql === "string" ? normalizeSql(option.sql) : "";
      if (!sqlText) throw new Error(`A query '${sourceName}/${queryName}' da recipe não possui SQL.`);
      const key = `${sourceName}/${queryName}`;
      queries.push({
        id: stableUuid(`recipe-query:${recipe.id}:${key}`),
        key,
        dashboardId: stableUuid(`recipe-dashboard:${recipe.id}`),
        dataSourceId: sourceId,
        name: `${recipe.name} · ${key}`,
        sqlText,
        parameters: recipeParameters(recipe),
        requiredPermissionKeys: typeof option.permission === "string" ? [option.permission] : [],
      });
    }
  }
  return queries;
}

function recipeDefinition(recipe: RecipeDocument, queryIds: Map<string, string>): DashboardDefinition {
  const ui = record(recipe.ui);
  const layout = record(ui.layout);
  const rawComponents = Array.isArray(ui.components) ? ui.components.map(record) : [];
  const components = rawComponents.flatMap((component) => {
    const props = record(component.props);
    const source = text(props.source, "");
    const query = text(props.query, "");
    const queryUuid = queryIds.get(`${source}/${query}`);
    if (!queryUuid) return [];
    const rawLayout = record(component.layoutProps);
    const rawType = text(component.component, "data_table");
    const type = rawType === "stat_card" || rawType === "bar_chart" || rawType === "pie_chart" || rawType === "data_table" ? rawType : "data_table";
    return [{
      id: text(component.id, `${source}-${query}`),
      type,
      title: text(props.title, text(component.id, "Componente")),
      queryUuid,
      layoutProps: { colSpan: Number(rawLayout.colSpan) || 12, rowSpan: Number(rawLayout.rowSpan) || 1 },
      props,
    }];
  });
  return dashboardDefinitionSchema.parse({
    layout: { columns: 12, gap: Number(layout.gap) || 16 },
    components,
  });
}

export async function syncRecipeDashboards(createdBy: string): Promise<{ dashboards: number; queries: number }> {
  const recipes = await getPersistedRecipes();
  let dashboardCount = 0;
  let queryCount = 0;

  for (const recipe of recipes) {
    const sourceRows = await db.select({ id: dataSources.id, name: dataSources.name }).from(dataSources);
    const sourceMap = new Map(sourceRows.map((source) => [source.name, source.id]));
    const queries = recipeQueries(recipe, sourceMap);
    const queryIds = new Map(queries.map((query) => [query.key, query.id]));
    const definition = recipeDefinition(recipe, queryIds);
    const dashboardId = stableUuid(`recipe-dashboard:${recipe.id}`);

    await db.insert(dashboards).values({
      id: dashboardId,
      name: recipe.name,
      description: typeof recipe.description === "string" ? recipe.description : null,
      definition,
      recipeId: recipe.id,
      createdBy,
    }).onConflictDoUpdate({
      target: dashboards.id,
      set: { name: recipe.name, description: typeof recipe.description === "string" ? recipe.description : null, definition, recipeId: recipe.id, updatedAt: new Date() },
    });
    await createResourcePermission(`dashboard:${dashboardId}:view`, `Visualizar dashboard: ${recipe.name}`, "Permite abrir o dashboard sincronizado pela recipe.");
    await grantPermissionKeys(createdBy, [`dashboard:${dashboardId}:view`]);

    const queryIdsInRecipe = queries.map((query) => query.id);
    const oldQueries = await db.select({ id: savedQueries.id }).from(savedQueries).where(eq(savedQueries.recipeId, recipe.id));
    const staleIds = oldQueries.map((query) => query.id).filter((id) => !queryIdsInRecipe.includes(id));
    if (staleIds.length > 0) {
      await db.delete(savedQueries).where(inArray(savedQueries.id, staleIds));
      await db.delete(permissions).where(inArray(permissions.key, staleIds.map((id) => `query:${id}:execute`)));
    }
    for (const query of queries) {
      await db.insert(savedQueries).values({ ...query, recipeId: recipe.id, recipeKey: query.key, createdBy }).onConflictDoUpdate({
        target: savedQueries.id,
        set: { dashboardId, dataSourceId: query.dataSourceId, name: query.name, sqlText: query.sqlText, parameters: query.parameters, requiredPermissionKeys: query.requiredPermissionKeys, recipeId: recipe.id, recipeKey: query.key, updatedAt: new Date() },
      });
      await createResourcePermission(`query:${query.id}:execute`, `Executar query: ${query.name}`, "Permite hidratar o dashboard sincronizado pela recipe.");
      await grantPermissionKeys(createdBy, [`query:${query.id}:execute`]);
      queryCount += 1;
    }
    dashboardCount += 1;
  }
  return { dashboards: dashboardCount, queries: queryCount };
}
