import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Clipboard, FileCode2, Save } from "lucide-react";
import { api } from "@/api";
import type { DataSource, QueryParameter, SavedQuery } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

const parameterSchema = z.object({
  name: z.string().trim().min(1),
  label: z.string().trim().min(1),
  type: z.enum(["text", "number", "date", "boolean", "multi_select"]),
  required: z.boolean(),
});

const queryFormSchema = z.object({
  dataSourceId: z.string().uuid("Selecione o servidor PostgreSQL."),
  name: z.string().trim().min(2, "Informe um nome com pelo menos 2 caracteres."),
  sqlText: z.string().trim().min(8, "Informe uma consulta SELECT."),
  parameters: z.string().min(2, "Informe um array JSON de parâmetros."),
});

type QueryForm = z.infer<typeof queryFormSchema>;

function parseParameters(raw: string): QueryParameter[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Os parâmetros devem conter JSON válido.");
  }
  return z.array(parameterSchema).parse(parsed);
}

function parseTestValues(raw: string): Record<string, string | string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Os valores de teste devem conter JSON válido.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Os valores de teste devem ser um objeto JSON.");
  }
  return z.record(z.union([z.string(), z.array(z.string())])).parse(parsed);
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "A operação falhou.";
}

export function QueryEditor({
  query,
  sources,
  open,
  onOpenChange,
  onSaved,
}: {
  query?: SavedQuery;
  sources: DataSource[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [createdQuery, setCreatedQuery] = useState<SavedQuery>();
  const activeQuery = query ?? createdQuery;
  const form = useForm<QueryForm>({
    resolver: zodResolver(queryFormSchema),
    defaultValues: {
      dataSourceId: query?.dataSourceId ?? "",
      name: query?.name ?? "",
      sqlText: query?.sqlText ?? "SELECT 1 AS valor",
      parameters: JSON.stringify(query?.parameters ?? [], null, 2),
    },
  });
  const [testValues, setTestValues] = useState("{}");
  const [testResult, setTestResult] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setCreatedQuery(undefined);
    form.reset({
      dataSourceId: query?.dataSourceId ?? "",
      name: query?.name ?? "",
      sqlText: query?.sqlText ?? "SELECT 1 AS valor",
      parameters: JSON.stringify(query?.parameters ?? [], null, 2),
    });
    setTestValues("{}");
    setTestResult("");
  }, [query, form, open]);

  const submit = async (values: QueryForm) => {
    try {
      const body = { ...values, parameters: parseParameters(values.parameters) };
      const saved = activeQuery
        ? await api.updateQuery(activeQuery.id, body)
        : await api.createQuery(body);
      setCreatedQuery(saved);
      toast.success(activeQuery ? "Query atualizada." : "Query criada. Copie o UUID para usar no dashboard.");
      await onSaved();
      if (query) onOpenChange(false);
    } catch (reason) {
      toast.error(errorMessage(reason));
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const values = z.object({
        dataSourceId: z.string().uuid("Selecione o servidor PostgreSQL."),
        sqlText: z.string().trim().min(8, "Informe uma consulta SELECT."),
        parameters: z.string().min(2, "Informe um array JSON de parâmetros."),
      }).parse(form.getValues());
      const result = await api.testQueryDraft({
        dataSourceId: values.dataSourceId,
        sqlText: values.sqlText,
        parameters: parseParameters(values.parameters),
        values: parseTestValues(testValues),
      });
      setTestResult(JSON.stringify(result.rows, null, 2));
      toast.success("Query executada com sucesso.");
    } catch (reason) {
      const text = errorMessage(reason);
      setTestResult(text);
      toast.error(text);
    } finally {
      setTesting(false);
    }
  };

  const copyId = async () => {
    if (!activeQuery) return;
    try {
      await navigator.clipboard.writeText(activeQuery.id);
      toast.success("UUID copiado.");
    } catch {
      toast.error("Não foi possível copiar o UUID.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-h-[900px] w-[calc(100%-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="border-b p-6">
          <DialogTitle>{activeQuery ? "Editar query" : "Nova query"}</DialogTitle>
          <DialogDescription>
            Salve uma consulta SELECT parametrizada. A lista vazia de usuários libera execução somente para administradores.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          <Form {...form}>
            <form id="query-form" onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-6 p-6">
              <FieldGroup>
                <FormField control={form.control} name="dataSourceId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Servidor PostgreSQL</FormLabel>
                    <FormControl>
                      <Select items={sources.map((source) => ({ value: source.id, label: source.name }))} value={field.value || null} name={field.name} onValueChange={(value) => field.onChange(value ?? "")}>
                        <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>{sources.map((source) => <SelectItem key={source.id} value={source.id}>{source.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem><FormLabel>Nome</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="sqlText" render={({ field }) => (
                  <FormItem>
                    <FormLabel>SQL SELECT</FormLabel>
                    <FormControl><Textarea {...field} className="min-h-48" spellCheck={false} /></FormControl>
                    <p className="text-xs text-muted-foreground">Use placeholders como {"{{start_date}}"}; os valores são enviados como parâmetros bind do PostgreSQL.</p>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="parameters" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Parâmetros aceitos (JSON)</FormLabel>
                    <FormControl><Textarea {...field} className="min-h-36 font-mono text-xs" spellCheck={false} /></FormControl>
                    <p className="text-xs text-muted-foreground">Cada entrada define name, label, type e required.</p>
                    <FormMessage />
                  </FormItem>
                )} />
              </FieldGroup>

              <Card>
                <CardHeader>
                  <CardTitle>Testar query</CardTitle>
                  <CardDescription>O teste usa a definição atual do formulário, mesmo antes de salvar.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Textarea value={testValues} onChange={(event) => setTestValues(event.target.value)} spellCheck={false} aria-label="Valores para teste em JSON" />
                  <div><Button type="button" variant="outline" onClick={() => void test()} disabled={testing}>{testing ? "Testando…" : <><FileCode2 /> Testar query</>}</Button></div>
                  {testResult && <pre className="max-h-60 overflow-auto border bg-muted p-3 text-xs">{testResult}</pre>}
                </CardContent>
              </Card>

              {activeQuery && (
                <Card>
                  <CardHeader><CardTitle>UUID da query</CardTitle><CardDescription>Use este ID nos componentes, opções e mapeamentos de parâmetros do dashboard.</CardDescription></CardHeader>
                  <CardContent className="flex items-center justify-between gap-3">
                    <code className="break-all text-xs">{activeQuery.id}</code>
                    <Button type="button" variant="outline" size="icon" onClick={() => void copyId()}><Clipboard /><span className="sr-only">Copiar UUID</span></Button>
                  </CardContent>
                </Card>
              )}
            </form>
          </Form>
        </ScrollArea>
        <DialogFooter className="flex-row justify-end gap-2 border-t bg-popover p-6">
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>Fechar</Button>
          <Button form="query-form" type="submit"><Save /> Salvar query</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
