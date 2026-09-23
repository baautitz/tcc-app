import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "./api";
import type { Dashboard, DashboardComponent, QueryParameter } from "./types";

type DataByQuery = Record<string, { rows?: Record<string, unknown>[]; error?: string; loading: boolean }>;
type FilterValues = Record<string, string>;

const colors = ["#2563eb", "#0891b2", "#0f766e", "#7c3aed", "#db2777", "#d97706"];

function componentString(component: DashboardComponent, property: string, fallback?: string): string | undefined {
  const value = component.props[property];
  return typeof value === "string" ? value : fallback;
}

function componentColumns(component: DashboardComponent, rows: Record<string, unknown>[]): string[] {
  const configured = component.props.columns;
  if (Array.isArray(configured)) {
    const keys = configured.flatMap((column) => typeof column === "object" && column !== null && "key" in column && typeof column.key === "string" ? [column.key] : []);
    if (keys.length > 0) return keys;
  }
  return rows.length === 0 ? [] : Object.keys(rows[0]);
}

function formatValue(value: unknown): string {
  if (typeof value === "number") return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
  if (value === null || value === undefined) return "—";
  return String(value);
}

function ComponentCard({ component, state }: { component: DashboardComponent; state: DataByQuery[string] | undefined }) {
  const rows = state?.rows ?? [];
  if (state?.loading || !state) return <section className="component-card skeleton" style={{ gridColumn: `span ${component.layoutProps.colSpan}` }}><p>{component.title}</p></section>;
  if (state.error) return <section className="component-card error-card" style={{ gridColumn: `span ${component.layoutProps.colSpan}` }}><h2>{component.title}</h2><p>{state.error}</p></section>;

  if (component.type === "stat_card") {
    const field = componentString(component, "field") ?? Object.keys(rows[0] ?? {})[0];
    return <section className="component-card stat-card" style={{ gridColumn: `span ${component.layoutProps.colSpan}` }}><p>{component.title}</p><strong>{formatValue(field ? rows[0]?.[field] : null)}</strong></section>;
  }

  const nameKey = componentString(component, "nameKey") ?? Object.keys(rows[0] ?? {})[0] ?? "label";
  const valueKey = componentString(component, "valueKey") ?? Object.keys(rows[0] ?? {})[1] ?? "value";
  if (component.type === "bar_chart") {
    return <section className="component-card chart-card" style={{ gridColumn: `span ${component.layoutProps.colSpan}` }}><h2>{component.title}</h2><ResponsiveContainer width="100%" height={280}><BarChart data={rows}><XAxis dataKey={nameKey} /><YAxis /><Tooltip /><Bar dataKey={valueKey} fill="#2563eb" radius={4} /></BarChart></ResponsiveContainer></section>;
  }
  if (component.type === "pie_chart") {
    return <section className="component-card chart-card" style={{ gridColumn: `span ${component.layoutProps.colSpan}` }}><h2>{component.title}</h2><ResponsiveContainer width="100%" height={280}><PieChart><Pie data={rows} dataKey={valueKey} nameKey={nameKey} outerRadius={96} label>{rows.map((_, index) => <Cell key={index} fill={colors[index % colors.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></section>;
  }
  const columns = componentColumns(component, rows);
  return <section className="component-card table-card" style={{ gridColumn: `span ${component.layoutProps.colSpan}` }}><h2>{component.title}</h2><div className="table-scroll"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{formatValue(row[column])}</td>)}</tr>)}</tbody></table>{rows.length === 0 && <p className="empty">Nenhum dado retornado.</p>}</div></section>;
}

function collectParameters(dashboard: Dashboard): QueryParameter[] {
  const parameters = new Map<string, QueryParameter>();
  for (const item of dashboard.queryParameters) for (const parameter of item.parameters) parameters.set(parameter.name, parameter);
  return [...parameters.values()];
}

function inputForParameter(parameter: QueryParameter, value: string, onChange: (value: string) => void) {
  if (parameter.type === "boolean") return <select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Todos</option><option value="true">Verdadeiro</option><option value="false">Falso</option></select>;
  return <input type={parameter.type === "date" ? "date" : parameter.type === "number" ? "number" : "text"} value={value} onChange={(event) => onChange(event.target.value)} placeholder={parameter.type === "multi_select" ? "Valores separados por vírgula" : parameter.label} />;
}

export function DashboardPage({ dashboardId, onBack }: { dashboardId: string; onBack: () => void }) {
  const [dashboard, setDashboard] = useState<Dashboard>();
  const [data, setData] = useState<DataByQuery>({});
  const [filters, setFilters] = useState<FilterValues>({});
  const [error, setError] = useState<string>();
  const parameterKey = JSON.stringify(filters);

  useEffect(() => {
    setDashboard(undefined);
    setData({});
    setError(undefined);
    api.dashboard(dashboardId).then(setDashboard).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar o dashboard."));
  }, [dashboardId]);

  useEffect(() => {
    if (!dashboard) return;
    const queryParameters = new Map(dashboard.queryParameters.map((item) => [item.queryUuid, item.parameters]));
    const componentQueries = [...new Set(dashboard.definition.components.map((component) => component.queryUuid))];
    setData(Object.fromEntries(componentQueries.map((queryUuid) => [queryUuid, { loading: true }])));
    void Promise.all(componentQueries.map(async (queryUuid) => {
      const params = new URLSearchParams();
      for (const parameter of queryParameters.get(queryUuid) ?? []) {
        const value = filters[parameter.name];
        if (!value) continue;
        if (parameter.type === "multi_select") value.split(",").map((item) => item.trim()).filter(Boolean).forEach((item) => params.append(parameter.name, item));
        else params.set(parameter.name, value);
      }
      try {
        const result = await api.query(queryUuid, params);
        setData((current) => ({ ...current, [queryUuid]: { rows: result.rows, loading: false } }));
      } catch (reason) {
        setData((current) => ({ ...current, [queryUuid]: { error: reason instanceof Error ? reason.message : "Falha ao carregar dados.", loading: false } }));
      }
    }));
  }, [dashboard, parameterKey]);

  if (error) return <main className="page"><button className="link-button" onClick={onBack}>← Dashboards</button><p className="error-text">{error}</p></main>;
  if (!dashboard) return <main className="page"><p>Carregando dashboard…</p></main>;
  const parameters = collectParameters(dashboard);
  return <main className="page"><button className="link-button" onClick={onBack}>← Dashboards</button><header className="page-heading"><div><h1>{dashboard.name}</h1><p>{dashboard.description}</p></div></header>{parameters.length > 0 && <section className="filters"><h2>Filtros</h2><div>{parameters.map((parameter) => <label key={parameter.name}>{parameter.label}{parameter.required && " *"}{inputForParameter(parameter, filters[parameter.name] ?? "", (value) => setFilters((current) => ({ ...current, [parameter.name]: value })))}</label>)}</div></section>}<div className="dashboard-grid" style={{ gap: `${dashboard.definition.layout.gap}px` }}>{dashboard.definition.components.map((component) => <ComponentCard key={component.id} component={component} state={data[component.queryUuid]} />)}{dashboard.definition.components.length === 0 && <p className="empty">Este dashboard ainda não possui componentes autorizados.</p>}</div></main>;
}
