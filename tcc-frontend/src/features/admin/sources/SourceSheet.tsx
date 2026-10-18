import { useEffect, useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Database } from "lucide-react";
import { api, ApiError } from "@/api";
import type { DataSource, DataSourceTable } from "@/types";
import { useEntityForm } from "@/shared/crud/useEntityForm";
import { errorMessage } from "@/shared/lib/errors";
import { toast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/shared/ui/form";
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/shared/ui/sheet";
import { FieldGroup } from "@/shared/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Textarea } from "@/shared/ui/textarea";

const sourceSchema = z.object({
  name: z.string().trim().min(1),
  host: z.string().trim().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  databaseName: z.string().trim().min(1),
  username: z.string().trim().min(1),
  password: z.string(),
  context: z.string(),
});
type SourceForm = z.infer<typeof sourceSchema>;
const toDefaults = (source?: DataSource): SourceForm => ({
  name: source?.name ?? "",
  host: source?.host ?? "",
  port: source?.port ?? 5432,
  databaseName: source?.databaseName ?? "",
  username: source?.username ?? "",
  password: "",
  context: source?.context ?? "",
});
export function SourceSheet({
  source,
  open,
  onOpenChange,
  onSaved,
}: {
  source?: DataSource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const { form, submit } = useEntityForm<SourceForm, DataSource>({
    resolver: zodResolver(sourceSchema),
    entity: source,
    open,
    toDefaults,
    onOpenChange,
    onSaved,
    save: async (values, form) => {
      const { password, ...fields } = values;
      const body = { ...fields, ...(password ? { password } : {}) };
      if (source) await api.updateDataSource(source.id, body);
      else {
        if (!values.password) {
          form.setError("password", {
            message: "A senha é obrigatória no cadastro.",
          });
          return;
        }
        await api.createDataSource(body);
      }
      return source
        ? "Servidor atualizado e validado."
        : "Servidor validado e salvo.";
    },
  });
  const [tables, setTables] = useState<DataSourceTable[]>([]);
  const [sourceUpdatedAt, setSourceUpdatedAt] = useState(source?.updatedAt ?? "");
  useEffect(() => {
    setSourceUpdatedAt(source?.updatedAt ?? "");
    if (source && open)
      api
        .dataSource(source.id)
        .then((detail) => {
          setTables(detail.tables);
          setSourceUpdatedAt(detail.updatedAt);
        })
        .catch((reason: Error) => toast.error(reason.message));
    else setTables([]);
  }, [source, open]);
  const saveContext = async (table: DataSourceTable, context: string) => {
    if (!source || context === table.context) return;
    try {
      const updated = await api.updateTableContext(
        source.id,
        table.id,
        context,
        sourceUpdatedAt,
        table.contextVersion,
      );
      setTables((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      );
      toast.success("Contexto da tabela salvo.");
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        try {
          const fresh = await api.dataSource(source.id);
          setSourceUpdatedAt(fresh.updatedAt);
          setTables(fresh.tables);
          toast.error(reason.message.includes("contexto da tabela")
            ? "O contexto desta tabela mudou em outra edição. Os dados foram recarregados; revise antes de salvar novamente."
            : "O servidor mudou enquanto você editava. Os dados foram recarregados; revise o contexto antes de salvar novamente.");
          return;
        } catch (reloadReason) {
          toast.error(
            `${errorMessage(reason)} Não foi possível recarregar o servidor: ${errorMessage(reloadReason)}`,
          );
          return;
        }
      }
      toast.error(errorMessage(reason));
    }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col p-0 sm:max-w-xl">
        <SheetHeader className="border-b p-6">
          <SheetTitle>
            {source ? "Editar servidor PostgreSQL" : "Novo servidor PostgreSQL"}
          </SheetTitle>
          <SheetDescription>
            O servidor é testado e validado pelo backend com privilégios somente
            leitura.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <Form {...form}>
            <form
              id="source-form"
              onSubmit={submit}
              className="flex flex-col gap-6 p-6"
            >
              <FieldGroup className="grid grid-cols-1 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="host"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Host</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="port"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Porta</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          onChange={(event) =>
                            field.onChange(event.target.valueAsNumber)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="databaseName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Banco</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Usuário</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {source ? "Senha (deixe vazia para manter)" : "Senha"}
                      </FormLabel>
                      <FormControl>
                        <Input {...field} type="password" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FieldGroup>
              <FormField
                control={form.control}
                name="context"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contexto geral</FormLabel>
                    <FormControl>
                      <Textarea {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {source && (
                <Card>
                  <CardHeader>
                    <CardTitle>Contextos de tabelas</CardTitle>
                    <CardDescription>
                      Descreva cada tabela catalogada para apoiar a criação de
                      queries.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    {tables.length ? (
                      tables.map((table) => (
                        <TableContextEditor
                          key={table.id}
                          table={table}
                          onSave={saveContext}
                        />
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Nenhuma tabela catalogada.
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}
            </form>
          </Form>
        </ScrollArea>
        <SheetFooter className="flex-row justify-end gap-2 border-t bg-popover p-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button form="source-form" type="submit">
            <Database /> Testar e salvar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
function TableContextEditor({
  table,
  onSave,
}: {
  table: DataSourceTable;
  onSave: (table: DataSourceTable, context: string) => Promise<void>;
}) {
  const [context, setContext] = useState(table.context);
  useEffect(() => setContext(table.context), [table.context]);
  return (
    <div className="flex flex-col gap-2 border-b pb-4 last:border-0">
      <p className="font-mono text-xs font-medium">
        {table.schemaName}.{table.tableName}
      </p>
      <Textarea
        value={context}
        onChange={(event) => setContext(event.target.value)}
      />
      <div>
        <Button variant="outline" onClick={() => void onSave(table, context)}>
          Salvar contexto
        </Button>
      </div>
    </div>
  );
}
