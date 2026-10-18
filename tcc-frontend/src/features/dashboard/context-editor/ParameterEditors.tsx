import { Trash2 } from "lucide-react";
import type {
  QueryParameterSource,
  DashboardArgument,
  DashboardDocumentComponent,
  DashboardOption,
} from "@/types";
import type { QueryParameter, QuerySummary } from "@/modules/queries/model/types";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";


export const componentTypes: Array<{ value: DashboardDocumentComponent["component"]; label: string }> = [
  { value: "stat_card", label: "Indicador" },
  { value: "bar_chart", label: "Gráfico de barras" },
  { value: "line_chart", label: "Gráfico de linhas" },
  { value: "pie_chart", label: "Gráfico de pizza" },
  { value: "data_table", label: "Tabela" },
];
export const parameterTypes: Array<{ value: QueryParameter["type"]; label: string }> = [
  { value: "text", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "date", label: "Data" },
  { value: "boolean", label: "Sim/não" },
  { value: "multi_select", label: "Múltipla seleção" },
];
const parameterTypeLabels = Object.fromEntries(parameterTypes.map((type) => [type.value, type.label])) as Record<QueryParameter["type"], string>;

function initialManualValue(parameter: QueryParameter): string | string[] {
  if (parameter.type === "multi_select") return [];
  if (parameter.type === "boolean") return "true";
  return "";
}

export function querySelectItems(queries: QuerySummary[], selectedId: string, emptyValue: string, emptyLabel: string) {
  const missingItem = selectedId && !queries.some((query) => query.id === selectedId)
    ? [{ value: selectedId, label: "Query não encontrada" }]
    : [];
  return [
    { value: emptyValue, label: emptyLabel },
    ...missingItem,
    ...queries.map((query) => ({ value: query.id, label: query.name })),
  ];
}

export function ManualOptionsEditor({ options, onChange }: { options: DashboardOption[]; onChange: (options: DashboardOption[]) => void }) {
  const savedRows = options.filter((option) => option.label || option.value);
  const rows = [...savedRows, { label: "", value: "" }];

  const updateOption = (index: number, field: keyof DashboardOption, value: string) => {
    const next = rows.map((option, rowIndex) => rowIndex === index ? { ...option, [field]: value } : option);
    onChange([...next.filter((option) => option.label || option.value), { label: "", value: "" }]);
  };

  const removeOption = (index: number) => {
    onChange([...savedRows.filter((_, rowIndex) => rowIndex !== index), { label: "", value: "" }]);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium">Opções manuais</p>
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-2 text-[11px] text-muted-foreground">
        <span>Label</span><span>Value</span><span className="size-8" aria-hidden="true" />
      </div>
      {rows.map((option, index) => {
        const emptyRow = index === rows.length - 1;
        return (
          <div key={emptyRow ? "new-option" : `option-${index}`} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
            <Input aria-label={`Rótulo da opção ${index + 1}`} placeholder="Label" value={option.label} onChange={(event) => updateOption(index, "label", event.target.value)} />
            <Input aria-label={`Valor da opção ${index + 1}`} placeholder="Value" value={option.value} onChange={(event) => updateOption(index, "value", event.target.value)} />
            {emptyRow ? <span className="size-8" aria-hidden="true" /> : <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => removeOption(index)} aria-label={`Remover opção ${index + 1}`}><Trash2 /></Button>}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">Preencha o rótulo e o valor. A última linha fica vazia para adicionar outra opção.</p>
    </div>
  );
}

export function QueryParameterEditor({
  parameter,
  source,
  argumentsList,
  onChange,
}: {
  parameter: QueryParameter;
  source?: QueryParameterSource;
  argumentsList: DashboardArgument[];
  onChange: (source: QueryParameterSource | undefined) => void;
}) {
  const matchingArguments = argumentsList.filter((argument) => argument.type === parameter.type);
  const mode = source?.source ?? "none";

  const chooseMode = (value: string) => {
    if (value === "none") return onChange(undefined);
    if (value === "context") {
      const argument = matchingArguments[0];
      if (argument) onChange({ source: "context", argument: argument.name });
      return;
    }
    onChange({ source: "manual", value: initialManualValue(parameter) });
  };

  const manualValue = source?.source === "manual" ? source.value : initialManualValue(parameter);

  return (
    <div className="grid gap-3 rounded-md border p-3 md:grid-cols-[minmax(8rem,1fr)_minmax(10rem,1.4fr)_minmax(10rem,1.6fr)] md:items-center">
      <div>
        <p className="font-mono text-sm">{parameter.name}{parameter.required ? " *" : ""}</p>
        <p className="text-xs text-muted-foreground">{parameter.label} · {parameterTypeLabels[parameter.type]}</p>
      </div>
      <Select items={[{ value: "none", label: parameter.required ? "Selecione uma origem" : "Sem valor (opcional)" }, { value: "context", label: "Parâmetro do contexto" }, { value: "manual", label: "Valor manual" }]} value={mode} onValueChange={(value) => chooseMode(value ?? "none")}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none" disabled={parameter.required}>{parameter.required ? "Selecione uma origem" : "Sem valor (opcional)"}</SelectItem>
          <SelectItem value="context" disabled={matchingArguments.length === 0}>Parâmetro do contexto</SelectItem>
          <SelectItem value="manual">Valor manual</SelectItem>
        </SelectContent>
      </Select>
      {source?.source === "context" ? (
        <Select items={matchingArguments.map((argument) => ({ value: argument.name, label: `${argument.label} · ${argument.name}` }))} value={source.argument} onValueChange={(value) => value && onChange({ ...source, argument: value })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{matchingArguments.map((argument) => <SelectItem key={argument.name} value={argument.name}>{argument.label} · {argument.name}</SelectItem>)}</SelectContent>
        </Select>
      ) : source?.source === "manual" ? (
        parameter.type === "boolean" ? (
          <Select items={[{ value: "true", label: "Verdadeiro" }, { value: "false", label: "Falso" }]} value={String(manualValue)} onValueChange={(value) => value && onChange({ source: "manual", value })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="true">Verdadeiro</SelectItem><SelectItem value="false">Falso</SelectItem></SelectContent>
          </Select>
        ) : (
          <Input
            type={parameter.type === "number" ? "number" : parameter.type === "date" ? "date" : "text"}
            value={Array.isArray(manualValue) ? manualValue.join(", ") : manualValue}
            placeholder={parameter.type === "multi_select" ? "Valores separados por vírgula" : "Valor fixo"}
            onChange={(event) => onChange({
              source: "manual",
              value: parameter.type === "multi_select"
                ? event.target.value.split(",").map((item) => item.trim()).filter(Boolean)
                : event.target.value,
            })}
          />
        )
      ) : <p className="text-xs text-muted-foreground">{parameter.required ? "Escolha um valor ou argumento." : "A query receberá null."}</p>}
    </div>
  );
}
