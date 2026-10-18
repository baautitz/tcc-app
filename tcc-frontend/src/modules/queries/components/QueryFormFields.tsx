import type { UseFormReturn } from "react-hook-form";
import type { DataSource } from "@/modules/data-sources/model/types";
import { FieldGroup } from "@/shared/ui/field";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/shared/ui/form";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";
import type { QueryForm } from "@/modules/queries/model/queryForm";

export function QueryFormFields({ form, sources, saving }: { form: UseFormReturn<QueryForm>; sources: DataSource[]; saving: boolean }) {
  return (
    <FieldGroup>
      <FormField
        control={form.control}
        name="dataSourceId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Servidor PostgreSQL</FormLabel>
            <FormControl>
              <Select
                items={sources.map((source) => ({
                  value: source.id,
                  label: source.name,
                }))}
                value={field.value || null}
                name={field.name}
                onValueChange={(value) => field.onChange(value ?? "")}
              >
                <SelectTrigger disabled={saving}>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      {source.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Nome</FormLabel>
            <FormControl>
              <Input {...field} disabled={saving} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="sqlText"
        render={({ field }) => (
          <FormItem>
            <FormLabel>SQL SELECT</FormLabel>
            <FormControl>
              <Textarea
                {...field}
                className="min-h-48"
                spellCheck={false}
                disabled={saving}
              />
            </FormControl>
            <p className="text-xs text-muted-foreground">
              Use placeholders como {"{{start_date}}"}; os valores são
              enviados como parâmetros bind do PostgreSQL.
            </p>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="parameters"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Parâmetros aceitos (JSON)</FormLabel>
            <FormControl>
              <Textarea
                {...field}
                className="min-h-36 font-mono text-xs"
                spellCheck={false}
                disabled={saving}
              />
            </FormControl>
            <p className="text-xs text-muted-foreground">
              Cada entrada define name, label, type e required.
            </p>
            <FormMessage />
          </FormItem>
        )}
      />
    </FieldGroup>
  );
}
