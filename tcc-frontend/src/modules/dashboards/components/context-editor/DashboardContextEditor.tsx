import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileCode2, Plus, Save, Trash2 } from "lucide-react";
import { dashboardsApi } from "@/modules/dashboards/api/dashboards.api";
import { queriesApi } from "@/modules/queries/api/queries.api";
import { errorMessage } from "@/shared/lib/errors";
import { componentQuery, dashboardValidationIssues } from "@/modules/dashboards/model/validate";
import { JsonEditorDialog } from "./JsonEditorDialog";
import { ManualOptionsEditor, QueryParameterEditor, componentTypes, parameterTypes, querySelectItems } from "./ParameterEditors";
import type {
  QueryParameterSource,
  DashboardArgument,
  DashboardDocumentComponent,
  DashboardDocument,
} from "@/modules/dashboards/model/types";
import type { QueryParameter, QuerySummary } from "@/modules/queries/model/types";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { toast } from "@/shared/ui/toast";

export function DashboardContextEditor({
  dashboardId,
  onBack,
}: {
  dashboardId: string;
  onBack: () => void;
}) {
  const [dashboard, setDashboard] = useState<DashboardDocument>();
  const [revision, setRevision] = useState<string>();
  const [queries, setQueries] = useState<QuerySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [jsonEditorOpen, setJsonEditorOpen] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonError, setJsonError] = useState<string>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    setDashboard(undefined);
    Promise.all([dashboardsApi.dashboardContext(dashboardId), queriesApi.queries()]).then(([result, queryCatalog]) => {
      if (active) {
        setDashboard(result.document);
        setRevision(result.revision);
        setQueries(queryCatalog);
      }
    }).catch((reason: Error) => {
      if (active) setError(reason.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [dashboardId]);

  const contextArguments = dashboard?.workspace.params ?? [];
  const linkedQueryIds = useMemo(() => {
    if (!dashboard) return [];
    const ids = new Set<string>();
    dashboard.ui.components.forEach((component) => {
      const id = componentQuery(component);
      if (id) ids.add(id);
    });
    dashboard.workspace.params.forEach((argument) => {
      if (argument.lookup?.queryUuid) ids.add(argument.lookup.queryUuid);
    });
    return [...ids];
  }, [dashboard]);
  const linkedQueries = linkedQueryIds.map((id) => queries.find((query) => query.id === id)).filter((query): query is QuerySummary => Boolean(query));
  const dashboardIssues = dashboard ? dashboardValidationIssues(dashboard, queries) : [];

  const updateDashboard = (change: (current: DashboardDocument) => DashboardDocument) => {
    setDashboard((current) => current ? change(current) : current);
  };

  const updateArgument = (index: number, patch: Partial<DashboardArgument>) => updateDashboard((current) => {
    const argument = current.workspace.params[index];
    const renamedBindings = argument && patch.name && patch.name !== argument.name
      ? current.queryBindings.map((binding) => ({
        ...binding,
        parameters: Object.fromEntries(Object.entries(binding.parameters).map(([name, source]) => [
          name,
          source.source === "context" && source.argument === argument.name ? { ...source, argument: patch.name! } : source,
        ])),
      }))
      : current.queryBindings;
    return {
      ...current,
      workspace: {
        ...current.workspace,
        params: current.workspace.params.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
      },
      queryBindings: renamedBindings,
    };
  });

  const removeArgument = (index: number) => updateDashboard((current) => {
    const removed = current.workspace.params[index];
    return {
      ...current,
      workspace: { ...current.workspace, params: current.workspace.params.filter((_, itemIndex) => itemIndex !== index) },
      queryBindings: removed ? current.queryBindings.map((binding) => ({
        ...binding,
        parameters: Object.fromEntries(Object.entries(binding.parameters).filter(([, source]) => !(source.source === "context" && source.argument === removed.name))),
      })) : current.queryBindings,
    };
  });

  const updateComponent = (index: number, change: (component: DashboardDocumentComponent) => DashboardDocumentComponent) => updateDashboard((current) => ({
    ...current,
    ui: { ...current.ui, components: current.ui.components.map((component, itemIndex) => itemIndex === index ? change(component) : component) },
  }));

  const updateParameterSource = (queryUuid: string, parameterName: string, source?: QueryParameterSource) => updateDashboard((current) => {
    const bindings = [...current.queryBindings];
    const index = bindings.findIndex((binding) => binding.queryUuid === queryUuid);
    const existing = index >= 0 ? bindings[index] : { queryUuid, parameters: {} };
    const parameters = { ...existing.parameters };
    if (source) parameters[parameterName] = source;
    else delete parameters[parameterName];
    const next = { ...existing, parameters };
    if (index >= 0) bindings[index] = next;
    else bindings.push(next);
    return { ...current, queryBindings: bindings };
  });

  const submit = async (candidate?: DashboardDocument): Promise<boolean> => {
    const sourceDashboard = candidate ?? dashboard;
    if (!sourceDashboard || !revision) return false;
    setSaving(true);
    try {
      const availableQueryIds = new Set(queries.map((query) => query.id));
      const sanitizedArguments = sourceDashboard.workspace.params.map((argument) => {
        const { options = [], ...argumentWithoutOptions } = argument;
        const completeOptions = options.filter((option) => option.label.trim() && option.value.trim());
        const incompleteOption = options.find((option) => Boolean(option.label.trim()) !== Boolean(option.value.trim()));
        if (incompleteOption) {
          throw new Error(`Preencha o rótulo e o valor de todas as opções de "${argument.label}".`);
        }
        const normalized = argument.type === "multi_select" && !argument.lookup && completeOptions.length
          ? { ...argumentWithoutOptions, options: completeOptions.map((option) => ({ label: option.label.trim(), value: option.value.trim() })) }
          : argumentWithoutOptions;
        if (normalized.lookup?.queryUuid && !availableQueryIds.has(normalized.lookup.queryUuid)) {
          return { ...normalized, lookup: { ...normalized.lookup, queryUuid: "" } };
        }
        return normalized;
      });
      const sanitizedComponents = sourceDashboard.ui.components.map((component) => {
        const selectedId = componentQuery(component);
        return selectedId && !availableQueryIds.has(selectedId)
          ? { ...component, props: { ...component.props, queryUuid: "" } }
          : component;
      });
      const referenceIds = new Set<string>();
      sanitizedComponents.forEach((component) => {
        const id = componentQuery(component);
        if (id) referenceIds.add(id);
      });
      sanitizedArguments.forEach((argument) => {
        if (argument.lookup?.queryUuid) referenceIds.add(argument.lookup.queryUuid);
      });
      const nextDashboard = {
        ...sourceDashboard,
        workspace: { ...sourceDashboard.workspace, params: sanitizedArguments },
        ui: { ...sourceDashboard.ui, components: sanitizedComponents },
        queryBindings: sourceDashboard.queryBindings.filter((binding) => referenceIds.has(binding.queryUuid) && availableQueryIds.has(binding.queryUuid)),
      };
      const result = await dashboardsApi.updateDashboardContext(nextDashboard.id, nextDashboard, revision);
      setDashboard(nextDashboard);
      setRevision(result.revision);
      const remainingIssues = dashboardValidationIssues(nextDashboard, queries);
      toast.success(remainingIssues.length
        ? `Dashboard salvo com ${remainingIssues.length} erro(s). Revise os avisos antes de disponibilizá-lo.`
        : "Dashboard salvo no arquivo JSON.");
      return true;
    } catch (reason) {
      toast.error(errorMessage(reason, "Não foi possível salvar o dashboard."));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openJsonEditor = () => {
    if (!dashboard) return;
    setJsonDraft(JSON.stringify(dashboard, null, 2));
    setJsonError(undefined);
    setJsonEditorOpen(true);
  };

  const saveJsonDraft = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonDraft);
    } catch {
      setJsonError("O conteúdo não é um JSON válido. Confira aspas, vírgulas e chaves.");
      return;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setJsonError("O JSON do dashboard precisa ser um objeto.");
      return;
    }
    if ((parsed as { id?: unknown }).id !== dashboardId) {
      setJsonError("O campo id deve permanecer igual ao identificador deste dashboard.");
      return;
    }
    const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
    const document = parsed as Record<string, unknown>;
    const workspace = document.workspace;
    const ui = document.ui;
    if (!isObject(workspace) || !Array.isArray(workspace.params) || !isObject(ui) || !Array.isArray(ui.components) || !Array.isArray(document.queryBindings)) {
      setJsonError("O JSON precisa conter workspace.params, ui.components e queryBindings em seus formatos de lista.");
      return;
    }

    setJsonError(undefined);
    const saved = await submit(parsed as DashboardDocument);
    if (saved) setJsonEditorOpen(false);
  };

  const addArgument = () => updateDashboard((current) => ({
    ...current,
    workspace: {
      ...current.workspace,
      params: [...current.workspace.params, { name: `argument_${current.workspace.params.length + 1}`, label: "Novo argumento", type: "text", required: false }],
    },
  }));

  const addComponent = () => updateDashboard((current) => ({
    ...current,
    ui: {
      ...current.ui,
      components: [...current.ui.components, {
        id: `component_${current.ui.components.length + 1}`,
        component: "data_table",
        layoutProps: { colSpan: 12, rowSpan: 1 },
        props: { title: "Novo componente", queryUuid: "" },
      }],
    },
  }));

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-center">
        <Button type="button" variant="ghost" onClick={onBack}><ArrowLeft /> Voltar</Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">Contexto do dashboard</h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">{dashboard?.name ?? dashboardId} · {dashboardId}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={openJsonEditor} disabled={!dashboard || loading || saving}><FileCode2 /> Editar JSON</Button>
          <Button type="button" onClick={() => void submit()} disabled={!dashboard || loading || saving}><Save /> {saving ? "Salvando…" : "Salvar dashboard"}</Button>
        </div>
      </header>
      {error && <Alert variant="destructive"><AlertTitle>Não foi possível carregar o dashboard</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {dashboard && dashboardIssues.length > 0 && <Alert variant="destructive"><AlertTitle>O dashboard contém erros</AlertTitle><AlertDescription><div><p>Você pode salvar o arquivo, mas corrija estes itens antes de disponibilizá-lo:</p><ul className="mt-2 list-disc pl-5">{dashboardIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div></AlertDescription></Alert>}
      {loading || !dashboard ? <Card><CardContent className="py-8 text-sm text-muted-foreground">{loading ? "Carregando dashboard…" : "Dashboard indisponível."}</CardContent></Card> : (
            <div className="flex flex-col gap-6">
              <Card>
                <CardHeader><CardTitle>Dashboard</CardTitle><CardDescription>Salvar atualiza o arquivo JSON desta dashboard.</CardDescription></CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <Label className="flex flex-col items-stretch gap-2 text-sm">Nome<Input value={dashboard.name} onChange={(event) => updateDashboard((current) => ({ ...current, name: event.target.value }))} /></Label>
                  <Label className="flex flex-col items-stretch gap-2 text-sm">Descrição<Input value={dashboard.description ?? ""} onChange={(event) => updateDashboard((current) => ({ ...current, description: event.target.value }))} /></Label>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3"><div><CardTitle>Contexto do dashboard</CardTitle><CardDescription>Argumentos que aparecem como filtros para quem abre o dashboard.</CardDescription></div><Button type="button" variant="outline" onClick={addArgument}><Plus /> Adicionar argumento</Button></div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {dashboard.workspace.params.map((argument, index) => (
                    <div key={`${argument.name}-${index}`} className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_1fr_1fr_auto_auto] md:items-end">
                      <Label className="flex flex-col items-stretch gap-2 text-xs">Nome do argumento<Input value={argument.name} onChange={(event) => updateArgument(index, { name: event.target.value })} /></Label>
                      <Label className="flex flex-col items-stretch gap-2 text-xs">Rótulo<Input value={argument.label} onChange={(event) => updateArgument(index, { label: event.target.value })} /></Label>
                      <Label className="flex flex-col items-stretch gap-2 text-xs">Tipo<Select items={parameterTypes.map((type) => ({ value: type.value, label: type.label }))} value={argument.type} onValueChange={(value) => value && updateArgument(index, { type: value as QueryParameter["type"], ...(value !== "multi_select" ? { options: undefined } : {}) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{parameterTypes.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent></Select></Label>
                      <Label className="flex items-center gap-2 text-xs"><Checkbox checked={argument.required} onCheckedChange={(checked) => updateArgument(index, { required: checked })} /> Obrigatório</Label>
                      <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => removeArgument(index)} aria-label="Remover argumento"><Trash2 /></Button>
                      <div className="md:col-span-4">
                        <div className="flex flex-col gap-3">
                          <Label className="flex items-center gap-2 text-xs">
                            <Checkbox
                              checked={Boolean(argument.lookup)}
                              disabled={!queries.length && !argument.lookup}
                              onCheckedChange={(checked) => updateArgument(index, checked
                                ? { lookup: { queryUuid: "", valueField: "value", labelField: "label" }, options: undefined }
                                : { lookup: undefined, options: [] })}
                            />
                            Query de opções
                          </Label>
                          {argument.lookup ? (
                            <div className="grid gap-2 md:grid-cols-3">
                              <Label className="flex flex-col items-stretch gap-2 text-xs">Selecionar query de opções<Select items={querySelectItems(queries, argument.lookup.queryUuid, "__no_lookup__", "Selecione uma query")} value={argument.lookup.queryUuid || "__no_lookup__"} onValueChange={(value) => updateArgument(index, { lookup: { ...argument.lookup!, queryUuid: value === "__no_lookup__" ? "" : value ?? "" } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__no_lookup__">Selecione uma query</SelectItem>{argument.lookup.queryUuid && !queries.some((query) => query.id === argument.lookup?.queryUuid) && <SelectItem value={argument.lookup.queryUuid}>Query não encontrada</SelectItem>}{queries.map((query) => <SelectItem key={query.id} value={query.id}>{query.name}</SelectItem>)}</SelectContent></Select></Label>
                              <Label className="flex flex-col items-stretch gap-2 text-xs">Campo do valor<Input value={argument.lookup.valueField} onChange={(event) => updateArgument(index, { lookup: { ...argument.lookup!, valueField: event.target.value } })} /></Label>
                              <Label className="flex flex-col items-stretch gap-2 text-xs">Campo do rótulo<Input value={argument.lookup.labelField} onChange={(event) => updateArgument(index, { lookup: { ...argument.lookup!, labelField: event.target.value } })} /></Label>
                              {argument.lookup.queryUuid && !queries.some((query) => query.id === argument.lookup?.queryUuid) && <p className="text-xs text-destructive md:col-span-3">A query de opções não existe no catálogo. Selecione uma query salva.</p>}
                              {!argument.lookup.queryUuid && <p className="text-xs text-destructive md:col-span-3">Selecione uma query de opções.</p>}
                            </div>
                          ) : argument.type === "multi_select" ? (
                            <ManualOptionsEditor options={argument.options ?? []} onChange={(options) => updateArgument(index, { options })} />
                          ) : (
                            <p className="text-xs text-muted-foreground">Sem query, o valor será informado diretamente no dashboard.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {!dashboard.workspace.params.length && <p className="text-sm text-muted-foreground">Sem argumentos de contexto.</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3"><div><CardTitle>Componentes</CardTitle><CardDescription>Todos os componentes deste dashboard e suas queries.</CardDescription></div><Button type="button" variant="outline" onClick={addComponent}><Plus /> Adicionar componente</Button></div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {dashboard.ui.components.map((component, index) => (
                    <div key={`${component.id}-${index}`} className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_1fr_1.5fr_1fr_auto] md:items-end">
                      <Label className="flex flex-col items-stretch gap-2 text-xs">ID<Input value={component.id} onChange={(event) => updateComponent(index, (current) => ({ ...current, id: event.target.value }))} /></Label>
                      <Label className="flex flex-col items-stretch gap-2 text-xs">Tipo<Select items={componentTypes.map((type) => ({ value: type.value, label: type.label }))} value={component.component} onValueChange={(value) => value && updateComponent(index, (current) => ({ ...current, component: value as DashboardDocumentComponent["component"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{componentTypes.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent></Select></Label>
                      <Label className="flex flex-col items-stretch gap-2 text-xs">Título<Input value={String(component.props.title ?? "")} onChange={(event) => updateComponent(index, (current) => ({ ...current, props: { ...current.props, title: event.target.value } }))} /></Label>
                      <Label className="flex flex-col items-stretch gap-2 text-xs">Query<Select items={querySelectItems(queries, componentQuery(component), "__no_query__", "Selecione uma query")} value={componentQuery(component) || "__no_query__"} onValueChange={(value) => updateComponent(index, (current) => ({ ...current, props: { ...current.props, queryUuid: value === "__no_query__" ? "" : value ?? "" } }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__no_query__">Selecione uma query</SelectItem>{componentQuery(component) && !queries.some((query) => query.id === componentQuery(component)) && <SelectItem value={componentQuery(component)}>Query não encontrada</SelectItem>}{queries.map((query) => <SelectItem key={query.id} value={query.id}>{query.name}</SelectItem>)}</SelectContent></Select></Label>
                      <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => updateDashboard((current) => ({ ...current, ui: { ...current.ui, components: current.ui.components.filter((_, itemIndex) => itemIndex !== index) } }))} aria-label="Remover componente"><Trash2 /></Button>
                      <Label className="flex flex-col items-stretch gap-2 text-xs md:col-span-2">Colunas (1 a 12)<Input type="number" min={1} max={12} value={component.layoutProps.colSpan} onChange={(event) => updateComponent(index, (current) => ({ ...current, layoutProps: { ...current.layoutProps, colSpan: event.target.valueAsNumber || 12 } }))} /></Label>
                      {componentQuery(component) && !queries.some((query) => query.id === componentQuery(component)) && <p className="text-xs text-destructive md:col-span-3">A query selecionada não existe no catálogo. Selecione uma query salva.</p>}
                      {!componentQuery(component) && <p className="text-xs text-destructive md:col-span-3">Selecione uma query para este componente.</p>}
                    </div>
                  ))}
                  {!dashboard.ui.components.length && <p className="text-sm text-muted-foreground">Este dashboard ainda não tem componentes.</p>}
                </CardContent>
              </Card>

              {linkedQueries.length > 0 && <Card>
                <CardHeader><CardTitle>Parâmetros das queries</CardTitle><CardDescription>As configurações são compartilhadas se a mesma query for usada por vários componentes.</CardDescription></CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {linkedQueries.map((query) => {
                    const binding = dashboard.queryBindings.find((item) => item.queryUuid === query.id);
                    return <div key={query.id} className="flex flex-col gap-3 border-b pb-4 last:border-0 last:pb-0">
                      <p className="font-medium">{query.name}</p>
                      {query.parameters.length ? query.parameters.map((parameter) => <QueryParameterEditor key={parameter.name} parameter={parameter} source={binding?.parameters[parameter.name]} argumentsList={contextArguments} onChange={(source) => updateParameterSource(query.id, parameter.name, source)} />) : <p className="text-xs text-muted-foreground">Esta query não recebe parâmetros.</p>}
                    </div>;
                  })}
                </CardContent>
              </Card>}
            </div>
          )}
      {dashboard && <footer className="flex justify-end border-t pt-5"><Button type="button" onClick={() => void submit()} disabled={saving}><Save /> {saving ? "Salvando…" : "Salvar dashboard"}</Button></footer>}
      <JsonEditorDialog
        open={jsonEditorOpen}
        saving={saving}
        draft={jsonDraft}
        error={jsonError}
        onDraftChange={(value) => { setJsonDraft(value); setJsonError(undefined); }}
        onOpenChange={setJsonEditorOpen}
        onSave={() => void saveJsonDraft()}
      />
    </div>
  );
}
