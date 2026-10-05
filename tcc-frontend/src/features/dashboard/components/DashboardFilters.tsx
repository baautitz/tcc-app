import { useEffect, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Filter } from "lucide-react";
import type { DashboardArgument } from "@/types";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { FieldGroup } from "@/shared/ui/field";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/ui/form";
import { DatePicker } from "@/shared/ui/date-picker";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { isIsoDateValue } from "../lib";
import type { DashboardFilterValues, FilterValues, QueryState } from "../types";

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
