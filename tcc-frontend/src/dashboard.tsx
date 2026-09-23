import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, ArrowLeft, BarChart3, Filter, RefreshCw, Table2 } from "lucide-react";
import { api } from "@/api";
import type { Dashboard, DashboardComponent, DashboardSummary, QueryParameter } from "@/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatValue } from "@/lib/utils";

type QueryState = { loading: boolean; rows?: Record<string, unknown>[]; error?: string };
type FilterValues = Record<string, string>;
const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const colSpanClass: Record<number, string> = { 1: "col-span-12 md:col-span-1", 2: "col-span-12 md:col-span-2", 3: "col-span-12 md:col-span-3", 4: "col-span-12 md:col-span-4", 5: "col-span-12 md:col-span-5", 6: "col-span-12 md:col-span-6", 7: "col-span-12 md:col-span-7", 8: "col-span-12 md:col-span-8", 9: "col-span-12 md:col-span-9", 10: "col-span-12 md:col-span-10", 11: "col-span-12 md:col-span-11", 12: "col-span-12" };
const gapClass: Record<number, string> = { 2: "gap-0.5", 4: "gap-1", 8: "gap-2", 12: "gap-3", 16: "gap-4", 20: "gap-5", 24: "gap-6", 32: "gap-8" };

function propertyString(component: DashboardComponent, key: string): string | undefined { const value = component.props[key]; return typeof value === "string" ? value : undefined; }
function componentColumns(component: DashboardComponent, rows: Record<string, unknown>[]): string[] { const configured = component.props.columns; if (Array.isArray(configured)) { const keys = configured.flatMap((item) => typeof item === "object" && item !== null && "key" in item && typeof item.key === "string" ? [item.key] : []); if (keys.length) return keys; } return rows[0] ? Object.keys(rows[0]) : []; }
function collectParameters(dashboard: Dashboard): QueryParameter[] { const parameters = new Map<string, QueryParameter>(); dashboard.queryParameters.forEach((query) => query.parameters.forEach((parameter) => parameters.set(parameter.name, parameter))); return [...parameters.values()]; }
function colClass(component: DashboardComponent): string { return colSpanClass[Math.min(12, Math.max(1, component.layoutProps.colSpan))] ?? "col-span-12"; }

function ComponentLoading({ component }: { component: DashboardComponent }) { return <Card className={colClass(component)}><CardHeader><Skeleton className="h-4 w-32" /></CardHeader><CardContent><Skeleton className="h-36 w-full" /></CardContent></Card>; }
function ComponentError({ component, message }: { component: DashboardComponent; message: string }) { return <Card className={colClass(component)}><CardHeader><CardTitle>{component.title}</CardTitle></CardHeader><CardContent><Alert variant="destructive"><AlertCircle /><AlertTitle>Dados indisponíveis</AlertTitle><AlertDescription>{message}</AlertDescription></Alert></CardContent></Card>; }
function DashboardComponentView({ component, state }: { component: DashboardComponent; state?: QueryState }) {
  if (!state || state.loading) return <ComponentLoading component={component} />;
  if (state.error) return <ComponentError component={component} message={state.error} />;
  const rows = state.rows ?? [];
  if (component.type === "stat_card") { const field = propertyString(component, "field") ?? Object.keys(rows[0] ?? {})[0]; return <Card className={colClass(component)}><CardHeader><CardDescription>{component.title}</CardDescription></CardHeader><CardContent><p className="text-3xl font-semibold tracking-tight">{formatValue(field ? rows[0]?.[field] : undefined)}</p></CardContent></Card>; }
  const nameKey = propertyString(component, "nameKey") ?? Object.keys(rows[0] ?? {})[0] ?? "label";
  const valueKey = propertyString(component, "valueKey") ?? Object.keys(rows[0] ?? {})[1] ?? "value";
  if (component.type === "bar_chart") return <Card className={colClass(component)}><CardHeader><CardTitle>{component.title}</CardTitle></CardHeader><CardContent><ResponsiveContainer width="100%" height={280}><BarChart data={rows}><XAxis dataKey={nameKey} tickLine={false} axisLine={false} fontSize={11} /><YAxis tickLine={false} axisLine={false} fontSize={11} /><Tooltip /><Bar dataKey={valueKey} fill="var(--chart-1)" radius={0} /></BarChart></ResponsiveContainer></CardContent></Card>;
  if (component.type === "pie_chart") return <Card className={colClass(component)}><CardHeader><CardTitle>{component.title}</CardTitle></CardHeader><CardContent><ResponsiveContainer width="100%" height={280}><PieChart><Pie data={rows} dataKey={valueKey} nameKey={nameKey} outerRadius={96}>{rows.map((row, index) => <Cell key={`${String(row[nameKey])}-${index}`} fill={colors[index % colors.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></CardContent></Card>;
  const columns = componentColumns(component, rows);
  return <Card className={colClass(component)}><CardHeader><CardTitle>{component.title}</CardTitle></CardHeader><CardContent>{rows.length ? <Table><TableHeader><TableRow>{columns.map((column) => <TableHead key={column}>{column}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={index}>{columns.map((column) => <TableCell key={column}>{formatValue(row[column])}</TableCell>)}</TableRow>)}</TableBody></Table> : <p className="py-6 text-center text-xs text-muted-foreground">Nenhum dado retornado.</p>}</CardContent></Card>;
}
function DashboardFilters({ parameters, onApply }: { parameters: QueryParameter[]; onApply: (values: FilterValues) => void }) {
  const form = useForm<FilterValues>({ resolver: zodResolver(z.record(z.string())), defaultValues: Object.fromEntries(parameters.map((parameter) => [parameter.name, ""])) });
  useEffect(() => { form.reset(Object.fromEntries(parameters.map((parameter) => [parameter.name, ""]))); }, [parameters, form]);
  if (!parameters.length) return null;
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Filter /> Filtros</CardTitle><CardDescription>Os filtros são aplicados somente às queries que os declaram.</CardDescription></CardHeader><CardContent><Form {...form}><form onSubmit={form.handleSubmit(onApply)}><FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-3">{parameters.map((parameter) => <FormField key={parameter.name} control={form.control} name={parameter.name} render={({ field }) => <FormItem><FormLabel>{parameter.label}{parameter.required ? " *" : ""}</FormLabel><FormControl>{parameter.type === "boolean" ? <Select value={field.value ?? ""} onChange={field.onChange}><option value="">Todos</option><option value="true">Verdadeiro</option><option value="false">Falso</option></Select> : <Input {...field} value={field.value ?? ""} type={parameter.type === "date" ? "date" : parameter.type === "number" ? "number" : "text"} placeholder={parameter.type === "multi_select" ? "Valores separados por vírgula" : parameter.label} />}</FormControl><FormMessage /></FormItem>} />)}<div className="flex items-end"><Button type="submit"><Filter /> Aplicar filtros</Button></div></FieldGroup></form></Form></CardContent></Card>;
}
function DashboardPage({ dashboardId, onBack }: { dashboardId: string; onBack: () => void }) {
  const [dashboard, setDashboard] = useState<Dashboard>(); const [data, setData] = useState<Record<string, QueryState>>({}); const [filters, setFilters] = useState<FilterValues>({}); const [error, setError] = useState<string>();
  const loadDashboard = () => { setDashboard(undefined); setData({}); setError(undefined); api.dashboard(dashboardId).then(setDashboard).catch((reason: Error) => setError(reason.message)); };
  useEffect(loadDashboard, [dashboardId]);
  useEffect(() => { if (!dashboard) return; const parameters = new Map(dashboard.queryParameters.map((query) => [query.queryUuid, query.parameters])); const queryIds = [...new Set(dashboard.definition.components.map((component) => component.queryUuid))]; setData(Object.fromEntries(queryIds.map((id) => [id, { loading: true }]))); queryIds.forEach((queryId) => { const search = new URLSearchParams(); parameters.get(queryId)?.forEach((parameter) => { const value = filters[parameter.name]; if (!value) return; if (parameter.type === "multi_select") value.split(",").map((item) => item.trim()).filter(Boolean).forEach((item) => search.append(parameter.name, item)); else search.set(parameter.name, value); }); api.query(queryId, search).then((result) => setData((current) => ({ ...current, [queryId]: { loading: false, rows: result.rows } }))).catch((reason: Error) => setData((current) => ({ ...current, [queryId]: { loading: false, error: reason.message } }))); }); }, [dashboard, filters]);
  if (error) return <Alert variant="destructive"><AlertCircle /><AlertTitle>Não foi possível carregar o dashboard</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>;
  if (!dashboard) return <div className="flex flex-col gap-6"><Skeleton className="h-8 w-64" /><div className="grid grid-cols-12 gap-4"><Skeleton className="col-span-12 h-32 md:col-span-6" /><Skeleton className="col-span-12 h-32 md:col-span-6" /><Skeleton className="col-span-12 h-96" /></div></div>;
  const parameters = collectParameters(dashboard); const gridGap = gapClass[dashboard.definition.layout.gap] ?? "gap-4";
  return <div className="flex flex-col gap-6"><div className="flex items-start gap-3"><Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft /><span className="sr-only">Voltar aos dashboards</span></Button><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold tracking-tight md:text-2xl">{dashboard.name}</h1><Badge variant="secondary">Dashboard</Badge></div><p className="mt-1 text-sm text-muted-foreground">{dashboard.description ?? "Componentes hidratados de forma assíncrona por UUID."}</p></div><Button variant="outline" size="icon" onClick={loadDashboard}><RefreshCw /><span className="sr-only">Atualizar dashboard</span></Button></div><DashboardFilters parameters={parameters} onApply={setFilters} /><div className={`grid grid-cols-12 ${gridGap}`}>{dashboard.definition.components.map((component) => <DashboardComponentView key={component.id} component={component} state={data[component.queryUuid]} />)}{dashboard.definition.components.length === 0 && <Card className="col-span-12"><CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground"><Table2 />Este dashboard ainda não possui componentes autorizados.</CardContent></Card>}</div></div>;
}
function DashboardListPage({ dashboards, loading, onOpen }: { dashboards: DashboardSummary[]; loading: boolean; onOpen: (id: string) => void }) { return <div className="flex flex-col gap-6"><div><h1 className="text-2xl font-bold tracking-tight">Dashboards disponíveis</h1><p className="mt-1 text-sm text-muted-foreground">Visualize indicadores e dados disponibilizados pelas suas permissões.</p></div>{loading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-36" />)}</div> : dashboards.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{dashboards.map((dashboard) => <Card key={dashboard.id} className="transition-colors hover:bg-muted/30"><CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 />{dashboard.name}</CardTitle><CardDescription>{dashboard.description ?? "Sem descrição"}</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => onOpen(dashboard.id)}>Abrir dashboard</Button></CardContent></Card>)}</div> : <Card><CardContent className="py-10 text-center text-muted-foreground">Nenhum dashboard foi liberado para este usuário.</CardContent></Card>}</div>; }
export { DashboardPage, DashboardListPage };
