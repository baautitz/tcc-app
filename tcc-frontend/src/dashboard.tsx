import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  BarChart3,
  Filter,
  Plus,
  RefreshCw,
  Settings,
  Table2,
  Users,
} from "lucide-react";
import { api } from "@/api";
import type {
  Dashboard,
  DashboardComponent,
  DashboardDefinition,
  DashboardSummary,
  DashboardArgument,
  DashboardUser,
} from "@/types";
import { useAuth } from "@/context/AuthContext";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { formatCurrencyValue, formatValue } from "@/lib/utils";
import { useRegisterCurrentViewRefresh } from "@/context/CurrentViewRefreshContext";

type QueryState = {
  loading: boolean;
  rows?: Record<string, unknown>[];
  error?: string;
  previewPending?: string;
};
type FilterValues = Record<string, string | string[]>;
const colors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];
const colSpanClass: Record<number, string> = {
  1: "col-span-12 @md:col-span-1",
  2: "col-span-12 @md:col-span-2",
  3: "col-span-12 @md:col-span-3",
  4: "col-span-12 @md:col-span-4",
  5: "col-span-12 @md:col-span-5",
  6: "col-span-12 @md:col-span-6",
  7: "col-span-12 @md:col-span-7",
  8: "col-span-12 @md:col-span-8",
  9: "col-span-12 @md:col-span-9",
  10: "col-span-12 @md:col-span-10",
  11: "col-span-12 @md:col-span-11",
  12: "col-span-12",
};
const gapClass: Record<number, string> = {
  2: "gap-0.5",
  4: "gap-1",
  8: "gap-2",
  12: "gap-3",
  16: "gap-4",
  20: "gap-5",
  24: "gap-6",
  32: "gap-8",
};
type DashboardComponentChange = "added" | "modified" | "unchanged";

function componentChangeClasses(status?: DashboardComponentChange) {
  switch (status) {
    case "added":
      return {
        card: "border-emerald-600/45 bg-emerald-500/5 dark:border-emerald-400/40 dark:bg-emerald-400/5",
        badge: "border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:border-emerald-400/40 dark:text-emerald-300",
        label: "Novo",
      };
    case "modified":
      return {
        card: "border-amber-600/45 bg-amber-500/5 dark:border-amber-400/40 dark:bg-amber-400/5",
        badge: "border-amber-600/40 bg-amber-500/10 text-amber-800 dark:border-amber-400/40 dark:text-amber-300",
        label: "Modificado",
      };
    case "unchanged":
      return {
        card: "border-border/70 bg-muted/10",
        badge: "border-border bg-muted text-muted-foreground",
        label: "Sem alteração",
      };
    default:
      return undefined;
  }
}

function ComponentPreviewHeader({
  component,
  changeStatus,
  stat = false,
}: {
  component: DashboardComponent;
  changeStatus?: DashboardComponentChange;
  stat?: boolean;
}) {
  const change = componentChangeClasses(changeStatus);
  return (
    <CardHeader>
      <div className="flex min-w-0 items-start justify-between gap-3">
        {stat ? (
          <CardDescription>{component.title}</CardDescription>
        ) : (
          <CardTitle>{component.title}</CardTitle>
        )}
        {change && (
          <Badge variant="outline" className={`shrink-0 ${change.badge}`}>
            {change.label}
          </Badge>
        )}
      </div>
    </CardHeader>
  );
}

function propertyString(
  component: DashboardComponent,
  key: string,
): string | undefined {
  const value = component.props[key];
  return typeof value === "string" ? value : undefined;
}
function componentColumns(
  component: DashboardComponent,
  rows: Record<string, unknown>[],
): string[] {
  const configured = component.props.columns;
  if (Array.isArray(configured)) {
    const keys = configured.flatMap((item) =>
      typeof item === "object" &&
      item !== null &&
      "key" in item &&
      typeof item.key === "string"
        ? [item.key]
        : [],
    );
    if (keys.length) return keys;
  }
  return rows[0] ? Object.keys(rows[0]) : [];
}
function collectArguments(dashboard: Dashboard): DashboardArgument[] {
  return dashboard.definition.workspace.params;
}
function queryArguments(
  dashboard: Dashboard,
  queryUuid: string,
  filters: FilterValues,
): URLSearchParams {
  const search = new URLSearchParams();
  const binding = dashboard.definition.queryBindings.find(
    (item) => item.queryUuid === queryUuid,
  );
  if (!binding) return search;
  for (const [parameterName, source] of Object.entries(binding.parameters)) {
    const value =
      source.source === "manual" ? source.value : filters[source.argument];
    if (Array.isArray(value))
      value
        .filter(Boolean)
        .forEach((item) => search.append(parameterName, item));
    else if (value) search.set(parameterName, value);
  }
  return search;
}
function isIsoDateValue(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
function numericChartRows(
  rows: Record<string, unknown>[],
  valueKey: string,
): Record<string, unknown>[] {
  return rows.map((row) => {
    const value = row[valueKey];
    if (typeof value !== "string" || value.trim() === "") return row;
    const numericValue = Number(value);
    return Number.isFinite(numericValue)
      ? { ...row, [valueKey]: numericValue }
      : row;
  });
}
function colClass(component: DashboardComponent): string {
  return (
    colSpanClass[Math.min(12, Math.max(1, component.layoutProps.colSpan))] ??
    "col-span-12"
  );
}

function ComponentLoading({ component }: { component: DashboardComponent }) {
  return (
    <Card className={colClass(component)}>
      <CardHeader>
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-36 w-full" />
      </CardContent>
    </Card>
  );
}
function ComponentError({
  component,
  message,
  changeStatus,
}: {
  component: DashboardComponent;
  message: string;
  changeStatus?: DashboardComponentChange;
}) {
  const change = componentChangeClasses(changeStatus);
  return (
    <Card className={[colClass(component), change?.card].filter(Boolean).join(" ")}>
      <ComponentPreviewHeader component={component} changeStatus={changeStatus} />
      <CardContent>
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Dados indisponíveis</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
function DashboardComponentView({
  component,
  state,
  changeStatus,
}: {
  component: DashboardComponent;
  state?: QueryState;
  changeStatus?: DashboardComponentChange;
}) {
  const change = componentChangeClasses(changeStatus);
  const cardClassName = [colClass(component), change?.card].filter(Boolean).join(" ");
  if (!state || (state.loading && state.rows === undefined))
    return <ComponentLoading component={component} />;
  if (state.previewPending && state.rows === undefined) {
    return (
      <Card className={cardClassName}>
        <ComponentPreviewHeader component={component} changeStatus={changeStatus} />
        <CardContent>
          <Alert>
            <AlertCircle />
            <AlertTitle>Prévia aguardando filtros</AlertTitle>
            <AlertDescription>{state.previewPending}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }
  if (state.error && state.rows === undefined)
    return <ComponentError component={component} message={state.error} changeStatus={changeStatus} />;
  const rows = state.rows ?? [];
  if (rows.length === 0) {
    return (
      <Card className={cardClassName}>
        <ComponentPreviewHeader component={component} changeStatus={changeStatus} />
        <CardContent>
          <p className="py-6 text-center text-xs text-muted-foreground">
            Nenhum dado retornado.
          </p>
        </CardContent>
      </Card>
    );
  }
  if (component.type === "stat_card") {
    const field =
      propertyString(component, "field") ?? Object.keys(rows[0] ?? {})[0];
    const value = field ? rows[0]?.[field] : undefined;
    const format = propertyString(component, "format");
    return (
      <Card className={cardClassName}>
        <ComponentPreviewHeader component={component} changeStatus={changeStatus} stat />
        <CardContent>
          <p className="text-3xl font-semibold tracking-tight">
            {format === "currency"
              ? formatCurrencyValue(value)
              : formatValue(value)}
          </p>
        </CardContent>
      </Card>
    );
  }
  if (component.type === "bar_chart" || component.type === "pie_chart") {
    const nameKey =
      propertyString(component, "nameKey") ??
      Object.keys(rows[0] ?? {})[0] ??
      "label";
    const valueKey =
      propertyString(component, "valueKey") ??
      Object.keys(rows[0] ?? {})[1] ??
      "value";
    const chartRows = numericChartRows(rows, valueKey).filter((row) => {
      const category = row[nameKey];
      const value = row[valueKey];
      return category !== null && category !== undefined && String(category).trim() !== ""
        && typeof value === "number" && Number.isFinite(value);
    });
    if (chartRows.length === 0) {
      const availableFields = Object.keys(rows[0] ?? {}).slice(0, 16).join(", ") || "nenhuma coluna retornada";
      return (
        <ComponentError
          component={component}
          message={`A query retornou dados, mas nenhuma linha corresponde à categoria '${nameKey}' e ao valor numérico '${valueKey}'. Aliases disponíveis: ${availableFields}. Corrija os aliases do componente ou da query.`}
          changeStatus={changeStatus}
        />
      );
    }
    if (component.type === "bar_chart")
      return (
        <Card className={cardClassName}>
          <ComponentPreviewHeader component={component} changeStatus={changeStatus} />
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartRows}>
                <XAxis
                  dataKey={nameKey}
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                />
                <YAxis tickLine={false} axisLine={false} fontSize={11} />
                <Tooltip />
                <Bar dataKey={valueKey} fill="var(--chart-1)" radius={0} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      );
    const rankedRows = chartRows
      .map((row, index) => ({ row, rank: Number(row.ranking ?? index + 1) }))
      .filter(
        (item) =>
          Number.isInteger(item.rank) && item.rank > 0 && item.rank <= 5,
      )
      .sort((left, right) => left.rank - right.rank);
    return (
      <Card className={cardClassName}>
        <ComponentPreviewHeader component={component} changeStatus={changeStatus} />
        <CardContent>
          <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,0.8fr)]">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={chartRows}
                  dataKey={valueKey}
                  nameKey={nameKey}
                  outerRadius={96}
                >
                  {chartRows.map((row, index) => (
                    <Cell
                      key={`${String(row[nameKey])}-${index}`}
                      fill={colors[index % colors.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium">Ranking por vendas</p>
              {rankedRows.map(({ row, rank }) => (
                <div
                  key={String(row[nameKey])}
                  title={String(row[nameKey])}
                  className="grid grid-cols-[1rem_1.5rem_minmax(0,1fr)_auto] items-center gap-2 text-xs"
                >
                  <span
                    className="size-2.5"
                    style={{
                      backgroundColor: colors[(rank - 1) % colors.length],
                    }}
                    aria-hidden="true"
                  />
                  <span className="text-muted-foreground">{rank}.</span>
                  <span className="truncate">{String(row[nameKey])}</span>
                  <span className="font-medium tabular-nums">
                    {formatValue(
                      typeof row[valueKey] === "string"
                        ? Number(row[valueKey])
                        : row[valueKey],
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
  const columns = componentColumns(component, rows);
  return (
    <Card className={cardClassName}>
      <ComponentPreviewHeader component={component} changeStatus={changeStatus} />
      <CardContent>
        {rows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={index}>
                  {columns.map((column) => (
                    <TableCell key={column}>
                      {formatValue(row[column])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Nenhum dado retornado.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardProposalCanvas({
  definition,
  rowsByQuery,
  componentIds,
  componentChanges,
}: {
  definition: DashboardDefinition;
  rowsByQuery: Record<string, { rows: Record<string, unknown>[]; error?: string; previewPending?: string }>;
  componentIds?: string[];
  componentChanges?: Record<string, DashboardComponentChange>;
}) {
  const gridGap = gapClass[definition.layout.gap] ?? "gap-4";
  const visibleComponentIds = componentIds ? new Set(componentIds) : undefined;
  const components = definition.components.filter((component) =>
    !visibleComponentIds || visibleComponentIds.has(component.id),
  );
  return (
    <div className={`@container grid grid-cols-12 ${gridGap}`}>
      {components.length > 0 ? components.map((component) => {
        const preview = rowsByQuery[component.queryUuid];
        return (
          <DashboardComponentView
            key={component.id}
            component={component}
            changeStatus={componentChanges?.[component.id]}
            state={{
              loading: false,
              ...(preview?.previewPending
                ? { previewPending: preview.previewPending }
                : preview?.error
                  ? { error: preview.error }
                  : { rows: preview?.rows ?? [] }),
            }}
          />
        );
      }) : (
        <p className="col-span-12 text-sm text-muted-foreground">
          Esta proposta não contém componentes para visualizar.
        </p>
      )}
    </div>
  );
}

export type DashboardFilterValues = Record<string, string | string[]>;

export function DashboardFilters({
  parameters,
  lookupData,
  appliedFilters,
  onApply,
  onValuesChange,
  heading = "Filtros",
  description = "Os argumentos são enviados somente às queries mapeadas pelo dashboard.",
  submitLabel = "Aplicar filtros",
  submitIcon = <Filter />,
  submitDisabled = false,
  showWhenEmpty = false,
  emptyMessage,
}: {
  parameters: DashboardArgument[];
  lookupData: Record<string, QueryState>;
  appliedFilters: FilterValues;
  onApply: (values: DashboardFilterValues) => void | Promise<void>;
  onValuesChange?: (values: DashboardFilterValues) => void;
  heading?: string;
  description?: string;
  submitLabel?: string;
  submitIcon?: ReactNode;
  submitDisabled?: boolean;
  showWhenEmpty?: boolean;
  emptyMessage?: string;
}) {
  const schema = z
    .record(z.union([z.string(), z.array(z.string())]))
    .superRefine((values, context) => {
      parameters.forEach((parameter) => {
        const value = values[parameter.name];
        const empty =
          value === undefined ||
          (Array.isArray(value)
            ? value.length === 0
            : value.trim().length === 0);
        if (parameter.required && empty)
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [parameter.name],
            message: `${parameter.label} é obrigatório.`,
          });
        if (
          parameter.type === "date" &&
          typeof value === "string" &&
          !empty &&
          !isIsoDateValue(value)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [parameter.name],
            message: "Informe uma data válida no formato DD/MM/AAAA.",
          });
        }
      });
    });
  const defaults = Object.fromEntries(
    parameters.map((parameter) => [
      parameter.name,
      parameter.type === "multi_select" ? [] : "",
    ]),
  );
  const form = useForm<FilterValues>({
    resolver: zodResolver(schema),
    defaultValues: { ...defaults, ...appliedFilters },
  });
  useEffect(() => {
    form.reset({ ...defaults, ...appliedFilters });
  }, [parameters, appliedFilters, form]);
  useEffect(() => {
    const subscription = form.watch((values, metadata) => {
      if (metadata.type === "change") onValuesChange?.(values as DashboardFilterValues);
    });
    return () => subscription.unsubscribe();
  }, [form, onValuesChange]);
  if (!parameters.length && !showWhenEmpty) return null;
  return (
    <Card className="@container">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Filter /> {heading}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onApply)}>
            <FieldGroup className="grid grid-cols-1 gap-4 @lg:grid-cols-3">
              {parameters.map((parameter) => (
                <FormField
                  key={parameter.name}
                  control={form.control}
                  name={parameter.name}
                  render={({ field }) => {
                    const stringValue =
                      typeof field.value === "string" ? field.value : "";
                    const arrayValue = Array.isArray(field.value)
                      ? field.value
                      : [];
                    const lookup = parameter.lookup
                      ? lookupData[parameter.lookup.queryUuid]
                      : undefined;
                    const options = parameter.lookup
                      ? (lookup?.rows ?? []).flatMap((row) => {
                          const value = row[parameter.lookup!.valueField];
                          const label = row[parameter.lookup!.labelField];
                          return value === null || value === undefined
                            ? []
                            : [
                                {
                                  value: String(value),
                                  label:
                                    label === null || label === undefined
                                      ? String(value)
                                      : String(label),
                                },
                              ];
                        })
                      : (parameter.options ?? []);
                    return (
                      <FormItem className="min-w-0">
                        <FormLabel className="break-words">
                          {parameter.label}
                          {parameter.required ? " *" : ""}
                        </FormLabel>
                        <FormControl>
                          {parameter.type === "multi_select" ? (
                            <Select
                              multiple
                              items={options}
                              value={arrayValue}
                              onValueChange={field.onChange}
                            >
                              <SelectTrigger>
                                <SelectValue>
                                  {(value: string[]) =>
                                    value.length
                                      ? `${value.length} selecionado(s)`
                                      : "Selecione opções"
                                  }
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {options.map((option) => (
                                  <SelectItem
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : parameter.lookup ? (
                            <Select
                              items={[
                                { value: "__all_values__", label: "Todos" },
                                ...options,
                              ]}
                              value={stringValue || "__all_values__"}
                              onValueChange={(value) =>
                                field.onChange(
                                  !value || value === "__all_values__"
                                    ? ""
                                    : value,
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__all_values__">
                                  Todos
                                </SelectItem>
                                {options.map((option) => (
                                  <SelectItem
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : parameter.type === "boolean" ? (
                            <Select
                              items={[
                                { value: "__all_values__", label: "Todos" },
                                { value: "true", label: "Verdadeiro" },
                                { value: "false", label: "Falso" },
                              ]}
                              value={stringValue || "__all_values__"}
                              onValueChange={(value) =>
                                field.onChange(
                                  !value || value === "__all_values__"
                                    ? ""
                                    : value,
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__all_values__">
                                  Todos
                                </SelectItem>
                                <SelectItem value="true">Verdadeiro</SelectItem>
                                <SelectItem value="false">Falso</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : parameter.type === "date" ? (
                            <DatePicker
                              value={stringValue}
                              onChange={field.onChange}
                              onBlur={field.onBlur}
                              label={parameter.label}
                            />
                          ) : (
                            <Input
                              {...field}
                              value={stringValue}
                              type={
                                parameter.type === "number" ? "number" : "text"
                              }
                              placeholder={parameter.label}
                              onChange={(event) =>
                                field.onChange(event.target.value)
                              }
                            />
                          )}
                        </FormControl>
                        {lookup?.error && (
                          <p className="text-xs text-destructive">
                            Não foi possível carregar as opções: {lookup.error}
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
              ))}
              {!parameters.length && emptyMessage && (
                <p className="text-xs text-muted-foreground @lg:col-span-2">
                  {emptyMessage}
                </p>
              )}
              <div className="flex items-end">
                <Button type="submit" disabled={submitDisabled}>
                  {submitIcon} {submitLabel}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
function DashboardUsersDialog({
  dashboardId,
  open,
  onOpenChange,
  onSaved,
}: {
  dashboardId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(undefined);
    api
      .dashboardUsers(dashboardId)
      .then((result) => {
        setUsers(result.users);
        setSelectedIds(result.userIds);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [dashboardId, open]);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateDashboardUsers(dashboardId, selectedIds);
      toast.success("Acesso ao dashboard atualizado.");
      onOpenChange(false);
      onSaved();
    } catch (reason) {
      toast.error(
        reason instanceof Error
          ? reason.message
          : "Não foi possível atualizar os usuários.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Usuários com acesso</DialogTitle>
          <DialogDescription>
            Dashboards sem usuários associados ficam disponíveis somente para
            administradores.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Não foi possível carregar os usuários</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="max-h-[55vh] overflow-y-auto rounded-md border p-3">
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : users.length ? (
            <div className="flex flex-col gap-3">
              {users.map((user) => (
                <Label
                  key={user.id}
                  htmlFor={`dashboard-user-${user.id}`}
                  className="flex cursor-pointer items-center gap-3 text-sm"
                >
                  <Checkbox
                    id={`dashboard-user-${user.id}`}
                    checked={selectedIds.includes(user.id)}
                    onCheckedChange={(checked) =>
                      setSelectedIds((current) =>
                        checked
                          ? [...current, user.id]
                          : current.filter((id) => id !== user.id),
                      )
                    }
                  />
                  <span>
                    {user.name} · {user.email}
                    {user.active ? "" : " (inativo)"}
                  </span>
                </Label>
              ))}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum usuário cadastrado.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            type="button"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading || Boolean(error)}
          >
            {saving ? "Salvando…" : "Salvar usuários"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DashboardPage({
  dashboardId,
  onEditContext,
}: {
  dashboardId: string;
  onEditContext: () => void;
}) {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<Dashboard>();
  const [data, setData] = useState<Record<string, QueryState>>({});
  const [filters, setFilters] = useState<FilterValues>({});
  const [error, setError] = useState<string>();
  const [usersDialogOpen, setUsersDialogOpen] = useState(false);
  const [dataRefreshVersion, setDataRefreshVersion] = useState(0);
  const querySequenceRef = useRef(0);
  const refreshData = useCallback(() => {
    setDataRefreshVersion((version) => version + 1);
    api.dashboard(dashboardId)
      .then(setDashboard)
      .catch((reason: Error) => setError(reason.message));
  }, [dashboardId]);
  useRegisterCurrentViewRefresh(refreshData);

  useEffect(() => {
    let active = true;
    setDashboard(undefined);
    setData({});
    setFilters({});
    setError(undefined);
    api
      .dashboard(dashboardId)
      .then((result) => {
        if (active) setDashboard(result);
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [dashboardId]);

  useEffect(() => {
    if (!dashboard) return;
    const requestSequence = ++querySequenceRef.current;
    const lookupIds = dashboard.definition.workspace.params.flatMap(
      (parameter) => (parameter.lookup ? [parameter.lookup.queryUuid] : []),
    );
    const queryIds = [
      ...new Set([
        ...dashboard.definition.components.map(
          (component) => component.queryUuid,
        ),
        ...lookupIds,
      ]),
    ];
    setData((current) => ({
      ...current,
      ...Object.fromEntries(
        queryIds.map((id) => {
          const previousRows = current[id]?.rows;
          return [
            id,
            {
              loading: true,
              ...(previousRows ? { rows: previousRows } : {}),
            },
          ] as const;
        }),
      ),
    }));
    queryIds.forEach((queryId) => {
      api
        .query(queryId, queryArguments(dashboard, queryId, filters))
        .then((result) => {
          if (querySequenceRef.current !== requestSequence) return;
          setData((current) => ({
            ...current,
            [queryId]: { loading: false, rows: result.rows },
          }));
        })
        .catch((reason: Error) => {
          if (querySequenceRef.current !== requestSequence) return;
          setData((current) => ({
            ...current,
            [queryId]: {
              loading: false,
              error: reason.message,
              ...(current[queryId]?.rows !== undefined
                ? { rows: current[queryId].rows }
                : {}),
            },
          }));
        });
    });
    return () => {
      if (querySequenceRef.current === requestSequence) {
        querySequenceRef.current += 1;
      }
    };
  }, [dashboard, filters, dataRefreshVersion]);

  if (error)
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>Não foi possível carregar o dashboard</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  if (!dashboard)
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-12 gap-4">
          <Skeleton className="col-span-12 h-32 md:col-span-6" />
          <Skeleton className="col-span-12 h-32 md:col-span-6" />
          <Skeleton className="col-span-12 h-96" />
        </div>
      </div>
    );
  const parameters = collectArguments(dashboard);
  const gridGap = gapClass[dashboard.definition.layout.gap] ?? "gap-4";
  const hasStaleDataErrors = Object.values(data).some(
    (state) => state.error && state.rows !== undefined,
  );
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight md:text-2xl">
              {dashboard.name}
            </h1>
            <Badge variant="secondary">Dashboard</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {dashboard.description || "Sem descrição."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {user?.isAdmin && (
            <>
              <Button
                variant="outline"
                size="icon"
                onClick={onEditContext}
                aria-label="Abrir contexto do dashboard"
              >
                <Settings />
                <span className="sr-only">Contexto do dashboard</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setUsersDialogOpen(true)}
                aria-label="Gerenciar usuários do dashboard"
              >
                <Users />
                <span className="sr-only">Gerenciar usuários</span>
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={refreshData}
            aria-label="Atualizar dashboard"
            title="Atualizar dados dos componentes"
          >
            <RefreshCw
              className={
                Object.values(data).some((state) => state.loading)
                  ? "animate-spin"
                  : undefined
              }
            />
          </Button>
        </div>
      </div>
      <DashboardFilters
        parameters={parameters}
        lookupData={data}
        appliedFilters={filters}
        onApply={setFilters}
      />
      {hasStaleDataErrors && (
        <Alert>
          <AlertCircle />
          <AlertTitle>Alguns dados não foram atualizados</AlertTitle>
          <AlertDescription>
            Os últimos resultados continuam visíveis. Revise as consultas com
            erro ou tente atualizar novamente.
          </AlertDescription>
        </Alert>
      )}
      <div className={`@container grid grid-cols-12 ${gridGap}`}>
        {dashboard.definition.components.map((component) => (
          <DashboardComponentView
            key={component.id}
            component={component}
            state={data[component.queryUuid]}
          />
        ))}
        {dashboard.definition.components.length === 0 && (
          <Card className="col-span-12">
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
              <Table2 />
              Este dashboard ainda não possui componentes.
            </CardContent>
          </Card>
        )}
      </div>
      <DashboardUsersDialog
        dashboardId={dashboardId}
        open={usersDialogOpen}
        onOpenChange={setUsersDialogOpen}
        onSaved={refreshData}
      />
    </div>
  );
}

function DashboardListPage({
  dashboards,
  loading,
  canCreate,
  onOpen,
}: {
  dashboards: DashboardSummary[];
  loading: boolean;
  canCreate: boolean;
  onOpen: (id: string) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (createOpen) {
      setName("");
      setDescription("");
    }
  }, [createOpen]);

  const createDashboard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const created = await api.createDashboard({
        name: name.trim(),
        description: description.trim(),
      });
      setCreateOpen(false);
      toast.success("Dashboard criado.");
      onOpen(created.id);
    } catch (reason) {
      toast.error(
        reason instanceof Error
          ? reason.message
          : "Não foi possível criar o dashboard.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboards</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dashboards associados ao seu usuário.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus /> Novo dashboard
          </Button>
        )}
      </div>
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-36" />
          ))}
        </div>
      ) : dashboards.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {dashboards.map((dashboard) => (
            <Card key={dashboard.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 />
                  {dashboard.name}
                </CardTitle>
                <CardDescription>
                  {dashboard.description ?? "Sem descrição."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" onClick={() => onOpen(dashboard.id)}>
                  Abrir dashboard
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum dashboard está associado a este usuário.
          </CardContent>
        </Card>
      )}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo dashboard</DialogTitle>
            <DialogDescription>
              Informe o nome e a descrição. O UUID será gerado automaticamente.
            </DialogDescription>
          </DialogHeader>
          <form
            id="create-dashboard-form"
            onSubmit={(event) => void createDashboard(event)}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="create-dashboard-name">Nome</Label>
              <Input
                id="create-dashboard-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={200}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="create-dashboard-description">Descrição</Label>
              <Textarea
                id="create-dashboard-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2000}
              />
            </div>
          </form>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => setCreateOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              form="create-dashboard-form"
              disabled={saving || !name.trim()}
            >
              <Plus /> {saving ? "Criando…" : "Criar dashboard"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { DashboardPage, DashboardListPage };
