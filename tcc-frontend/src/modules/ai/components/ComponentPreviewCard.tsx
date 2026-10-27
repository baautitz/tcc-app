import { useMemo, useState } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { DashboardComponentView } from "@/modules/dashboards/components/DashboardComponentView";
import type { DashboardComponent } from "@/modules/dashboards/model/types";
import {
  isExpired,
  type ComponentAdjustment,
  type ComponentPreviewItem,
  type ComponentType,
} from "@/modules/ai/model/chat-items";

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
  onApprove: (item: ComponentPreviewItem) => void;
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

  const expired = isExpired(item.expiresAt);
  const decided = Boolean(item.status);
  const canAct = isLatestInteraction && !decided && !expired;
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

      {item.parameters && item.parameters.length > 0 && (
        <dl className="grid gap-1 border bg-background p-2 text-xs">
          <dt className="font-medium text-muted-foreground">
            Parâmetros usados nesta prévia
          </dt>
          {item.parameters.map((parameter) => (
            <dd key={parameter.name} className="flex flex-wrap gap-1">
              <span className="font-medium">{parameter.label}:</span>
              <span>
                {parameter.value === null
                  ? parameter.required
                    ? "não informado"
                    : "sem filtro (todos)"
                  : Array.isArray(parameter.value)
                    ? parameter.value.join(", ") || "sem filtro (todos)"
                    : parameter.value}
              </span>
            </dd>
          ))}
        </dl>
      )}

      <div className="@container grid grid-cols-12 gap-4">
        <DashboardComponentView
          component={{
            ...viewComponent,
            layoutProps: { colSpan: 12, rowSpan: 1 },
          }}
          state={
            item.query.error
              ? { loading: false, error: item.query.error }
              : { loading: false, rows: item.query.rows }
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
            <Button size="sm" disabled={busy} onClick={() => onApprove(item)}>
              Aprovar
            </Button>
          </div>
        )}
      </footer>
    </section>
  );
}
