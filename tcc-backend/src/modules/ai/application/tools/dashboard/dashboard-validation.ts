import type { DashboardDocument } from "../../../../dashboards/domain/dashboards.js";
import type { AiDashboardQueryPreview } from "./dashboard-types.js";

export function validateDashboardPreviewFields(
  document: DashboardDocument,
  rowsByQuery: Record<string, AiDashboardQueryPreview>,
  componentIds?: Set<string>,
  argumentNames?: Set<string>,
): string[] {
  const issues: string[] = [];
  for (const component of document.ui.components.filter((item) => !componentIds || componentIds.has(item.id))) {
    const props = component.props as Record<string, unknown>;
    const queryUuid = String(props.queryUuid);
    const rows = rowsByQuery[queryUuid]?.rows ?? [];
    if (!String(props.title ?? "").trim()) issues.push(`O componente '${component.id}' precisa de um título.`);
    if (rowsByQuery[queryUuid]?.previewPending) continue;
    if (rowsByQuery[queryUuid]?.error) {
      issues.push(`A query do componente '${component.id}' falhou: ${rowsByQuery[queryUuid]?.error}`);
      continue;
    }
    const keys = rows[0] ? new Set(Object.keys(rows[0])) : new Set<string>();
    if (!rows.length) {
      issues.push(`A query do componente '${component.id}' não retornou dados para a prévia. Ajuste a query ou os parâmetros.`);
      continue;
    }
    if (component.component === "stat_card") {
      if (typeof props.field !== "string" || !keys.has(props.field)) issues.push(`O campo do cartão '${component.id}' não existe no resultado da query.`);
      else if (!rows.some((row) => row[props.field as string] !== null && row[props.field as string] !== undefined)) issues.push(`O campo do cartão '${component.id}' não possui valor na prévia.`);
      continue;
    }
    if (component.component === "bar_chart" || component.component === "pie_chart") {
      const availableFields = [...keys].slice(0, 16);
      const availableFieldsLabel = availableFields.length > 0
        ? availableFields.join(", ")
        : "nenhuma coluna retornada";
      for (const [role, field] of [["categoria", props.nameKey], ["valor", props.valueKey]] as const) {
        if (typeof field !== "string" || !keys.has(field)) {
          issues.push(`O gráfico '${component.id}' usa '${String(field)}' como ${role}, mas esse alias não existe. Aliases disponíveis: ${availableFieldsLabel}.`);
        }
      }
      const hasNumericValue = (value: unknown) =>
        typeof value === "number"
          ? Number.isFinite(value)
          : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
      const hasRenderablePoint = typeof props.nameKey === "string" && typeof props.valueKey === "string"
        && rows.some((row) => {
          const category = row[props.nameKey as string];
          return category !== null && category !== undefined && String(category).trim() !== ""
            && hasNumericValue(row[props.valueKey as string]);
        });
      if (!hasRenderablePoint) issues.push(`O gráfico '${component.id}' precisa retornar ao menos uma linha com categoria preenchida e valor numérico nos aliases configurados.`);
      continue;
    }
    const columns = props.columns;
    if (!Array.isArray(columns) || columns.some((column) => !column || typeof column !== "object" || !("key" in column) || typeof column.key !== "string" || !keys.has(column.key))) {
      issues.push(`As colunas da tabela '${component.id}' precisam corresponder aos aliases da query.`);
    } else if (!rows.some((row) => columns.some((column) => row[column.key] !== null && row[column.key] !== undefined))) {
      issues.push(`A tabela '${component.id}' não possui valores nas colunas configuradas.`);
    }
  }
  for (const argument of document.workspace.params.filter((item) => !argumentNames || argumentNames.has(item.name))) {
    const lookup = argument.lookup;
    if (!lookup) continue;
    const keys = new Set(Object.keys(rowsByQuery[lookup.queryUuid]?.rows[0] ?? {}));
    if (!keys.has(lookup.valueField) || !keys.has(lookup.labelField)) {
      issues.push(`A query de opções do filtro '${argument.label}' não retornou os campos configurados.`);
    }
  }
  return [...new Set(issues)];
}
