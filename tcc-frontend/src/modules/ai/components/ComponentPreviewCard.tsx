import { useCallback, useMemo, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { DashboardComponentView } from "@/modules/dashboards/components/DashboardComponentView";
import { DashboardFilters } from "@/modules/dashboards/components/DashboardFilters";
import type {
  DashboardArgument,
  DashboardComponent,
  DashboardFilterValues,
} from "@/modules/dashboards/model/types";
import { aiApi } from "@/modules/ai/api/ai.api";
import {
  isExpired,
  type ComponentAdjustment,
  type ComponentPreviewItem,
  type ComponentType,
  type ComponentValues,
} from "@/modules/ai/model/chat-items";

const FILTER_PREFIX = "filter:";
const PARAMETER_PREFIX = "param:";

/** Só valores preenchidos seguem para o backend. */
function withoutBlanks(values: Record<string, string | string[]>) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) =>
      Array.isArray(value) ? value.length > 0 : value.trim().length > 0,
    ),
  );
}

const typeLabels: Record<ComponentType, string> = {
  stat_card: "Indicador (stat_card)",
  bar_chart: "Barras (bar_chart)",
  line_chart: "Linhas (line_chart)",
  pie_chart: "Pizza (pie_chart)",
  data_table: "Tabela (data_table)",
};

/** Fase 3: o componente renderizado sozinho. Aprovar ou pedir ajuste não persistem nada. */
export function ComponentPreviewCard({
  item,
  busy,
  isLatestInteraction,
  onApprove,
  onAdjust,
}: {
  item: ComponentPreviewItem;
  busy: boolean;
  isLatestInteraction: boolean;
  onApprove: (item: ComponentPreviewItem, values: ComponentValues) => void;
  onAdjust: (
    item: ComponentPreviewItem,
    adjustment: ComponentAdjustment,
  ) => void;
}) {
  const { component } = item;
  const [adjusting, setAdjusting] = useState(false);
  const [type, setType] = useState<ComponentType>(component.component);
  const [title, setTitle] = useState(component.title);
  const [colSpan, setColSpan] = useState(String(component.colSpan));

  const viewComponent = useMemo<DashboardComponent>(() => {
    const {
      id,
      component: kind,
      title: componentTitle,
      queryUuid,
      colSpan: span,
      ...config
    } = component;
    return {
      id,
      type: kind,
      title: componentTitle,
      queryUuid,
      layoutProps: { colSpan: span, rowSpan: 1 },
      props: { ...config, title: componentTitle, queryUuid },
    };
  }, [component]);

  // Valores aplicados (os que geraram o resultado exibido) e resultado atual.
  const [applied, setApplied] = useState<ComponentValues>({
    contextValues: item.contextValues ?? {},
    parameterValues: item.parameterValues ?? {},
  });
  const [query, setQuery] = useState(item.query);
  const [applying, setApplying] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [applyError, setApplyError] = useState<string>();

  // Um só formulário: filtros do Dashboard ativo + parâmetros da query sem filtro.
  const fields = useMemo<DashboardArgument[]>(() => {
    const parameters = item.parameters ?? [];
    const filters = (item.filters ?? []).map((filter) => {
      const bound = parameters.filter(
        (parameter) => parameter.bound === filter.name,
      );
      return {
        ...filter,
        name: `${FILTER_PREFIX}${filter.name}`,
        // Só é obrigatório se alimenta uma query que o exige.
        required:
          bound.length > 0 &&
          (filter.required || bound.some((parameter) => parameter.required)),
      };
    });
    const own = parameters
      .filter((parameter) => parameter.bound === null)
      .map((parameter) => ({
        name: `${PARAMETER_PREFIX}${parameter.name}`,
        label: parameter.label,
        type: parameter.type,
        required: parameter.required,
      }));
    return [...filters, ...own];
  }, [item.filters, item.parameters]);
  const appliedFields = useMemo<DashboardFilterValues>(
    () => ({
      ...Object.fromEntries(
        Object.entries(applied.contextValues).map(([name, value]) => [
          `${FILTER_PREFIX}${name}`,
          value,
        ]),
      ),
      ...Object.fromEntries(
        Object.entries(applied.parameterValues).map(([name, value]) => [
          `${PARAMETER_PREFIX}${name}`,
          value,
        ]),
      ),
    }),
    [applied],
  );
  const lookupData = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(item.lookups ?? {}).map(([queryId, lookup]) => [
          queryId,
          { loading: false, ...lookup },
        ]),
      ),
    [item.lookups],
  );
  const onValuesChange = useCallback(() => setDirty(true), []);
  const applyFilters = async (values: DashboardFilterValues) => {
    const next: ComponentValues = { contextValues: {}, parameterValues: {} };
    for (const [name, value] of Object.entries(values)) {
      if (name.startsWith(FILTER_PREFIX))
        next.contextValues[name.slice(FILTER_PREFIX.length)] = value;
      else if (name.startsWith(PARAMETER_PREFIX))
        next.parameterValues[name.slice(PARAMETER_PREFIX.length)] = value;
    }
    next.contextValues = withoutBlanks(next.contextValues);
    next.parameterValues = withoutBlanks(next.parameterValues);
    setApplying(true);
    setApplyError(undefined);
    try {
      const result = await aiApi.previewAiComponentReceipt(
        item.receiptId,
        next,
      );
      setQuery(result.query);
      setApplied(next);
      setDirty(false);
    } catch (error) {
      setApplyError(
        error instanceof Error
          ? error.message
          : "Não foi possível aplicar os filtros.",
      );
    } finally {
      setApplying(false);
    }
  };

  const expired = isExpired(item.expiresAt);
  const decided = Boolean(item.status);
  const canAct = isLatestInteraction && !decided && !expired;
  const canActOrPending = isLatestInteraction && !decided;
  const spanValue = Number(colSpan);
  const spanValid =
    Number.isInteger(spanValue) && spanValue >= 1 && spanValue <= 12;
  const adjustment: ComponentAdjustment = {
    ...(type !== component.component ? { component: type } : {}),
    ...(title.trim() && title.trim() !== component.title
      ? { title: title.trim() }
      : {}),
    ...(spanValid && spanValue !== component.colSpan
      ? { colSpan: spanValue }
      : {}),
  };

  return (
    <section className="@container mx-3 flex min-w-0 flex-col gap-3 border border-primary/30 bg-primary/5 p-3 text-sm sm:mx-4">
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">
          Componente isolado · {typeLabels[component.component]}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Largura {component.colSpan} de 12 colunas. Nada é salvo nesta etapa.
        </p>
      </div>

      {fields.length > 0 && (
        <div className="flex flex-col gap-1">
          <DashboardFilters
            parameters={fields}
            lookupData={lookupData}
            appliedFilters={appliedFields}
            onApply={applyFilters}
            onValuesChange={onValuesChange}
            heading="Filtros do dashboard"
            description="Os valores são usados apenas nesta prévia; ao aprovar, seguem para a proposta."
            submitLabel={applying ? "Aplicando…" : "Aplicar filtros"}
            submitIcon={
              applying ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <RefreshCw />
              )
            }
            submitDisabled={applying || busy || expired || !canActOrPending}
          />
          {applyError && (
            <p className="text-xs text-destructive">{applyError}</p>
          )}
        </div>
      )}

      <div className="@container grid grid-cols-12 gap-4">
        <DashboardComponentView
          component={{
            ...viewComponent,
            layoutProps: { colSpan: 12, rowSpan: 1 },
          }}
          state={
            query.error
              ? { loading: false, error: query.error }
              : { loading: false, rows: query.rows }
          }
        />
      </div>

      {adjusting && canAct && (
        <form
          className="flex flex-col gap-3 border-t border-primary/15 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            onAdjust(item, adjustment);
          }}
        >
          <Label className="flex flex-col items-start gap-1 text-xs">
            Tipo
            <select
              className="h-8 w-full border border-input bg-transparent px-2 text-xs"
              value={type}
              onChange={(event) => setType(event.target.value as ComponentType)}
            >
              {Object.entries(typeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Label>
          <Label className="flex flex-col items-start gap-1 text-xs">
            Título
            <Input
              value={title}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Label>
          <Label className="flex flex-col items-start gap-1 text-xs">
            Largura (1 a 12 colunas)
            <Input
              type="number"
              min={1}
              max={12}
              value={colSpan}
              onChange={(event) => setColSpan(event.target.value)}
            />
          </Label>
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={
                busy || !spanValid || Object.keys(adjustment).length === 0
              }
            >
              Enviar ajuste
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAdjusting(false)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}

      <footer className="flex min-w-0 flex-col gap-2 border-t border-primary/15 pt-3 @md:flex-row @md:items-center @md:justify-between">
        <span className="min-w-0 text-xs text-muted-foreground">
          {item.status === "approved"
            ? "Componente aprovado."
            : item.status === "approving"
              ? "Aprovando…"
              : item.status === "adjusting"
                ? "Ajuste pedido; aguarde o novo componente."
                : item.status === "superseded" || !isLatestInteraction
                  ? "Substituído por outra versão."
                  : expired
                    ? "Aprovação expirada. Peça um novo componente."
                    : dirty
                      ? "Aplique os filtros para aprovar o que está na tela."
                      : "Aprove para escolher destino e posição."}
        </span>
        {canAct && !adjusting && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setAdjusting(true)}
            >
              Pedir ajuste
            </Button>
            <Button
              size="sm"
              disabled={busy || applying || dirty}
              onClick={() => onApprove(item, applied)}
            >
              Aprovar
            </Button>
          </div>
        )}
      </footer>
    </section>
  );
}
