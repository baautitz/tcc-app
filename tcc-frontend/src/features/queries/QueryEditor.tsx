import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Clipboard, FileCode2, Save } from "lucide-react";
import { api } from "@/api";
import { errorMessage } from "@/lib/errors";
import { useSaveQuery } from "./useSaveQuery";
import { QueryFormFields } from "./QueryFormFields";
import { QueryPreviewPanel } from "./QueryPreviewPanel";
import { parseParameters, parseTestValues, queryFormSchema, type QueryForm, type ReviewedQueryPreview } from "./queryForm";
import type { DataSource, SavedQuery } from "@/types";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Form } from "@/shared/ui/form";
import { ScrollArea } from "@/shared/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Textarea } from "@/shared/ui/textarea";
import { toast } from "@/shared/ui/toast";
import { useAuth } from "@/context/AuthContext";

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
  const [reloadedQuery, setReloadedQuery] = useState<SavedQuery>();
  const activeQuery = reloadedQuery ?? query ?? createdQuery;
  const { hasPermission } = useAuth();
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
  const [preview, setPreview] = useState<ReviewedQueryPreview>();
  const [testing, setTesting] = useState(false);
  const { pendingRef: savePendingRef, saving, run: runSave, persist, reloadOnConflict, isConflict } = useSaveQuery();
  const watchedSourceId = form.watch("dataSourceId");
  const watchedSqlText = form.watch("sqlText");
  const watchedParameters = form.watch("parameters");
  const watchedName = form.watch("name");
  const currentDraftKey = JSON.stringify({
    dataSourceId: watchedSourceId,
    sqlText: watchedSqlText.trim(),
    parameters: watchedParameters,
    testValues,
    queryId: activeQuery?.id ?? null,
    queryUpdatedAt: activeQuery?.updatedAt ?? null,
  });

  useEffect(() => {
    setCreatedQuery(undefined);
    setReloadedQuery(undefined);
    form.reset({
      dataSourceId: query?.dataSourceId ?? "",
      name: query?.name ?? "",
      sqlText: query?.sqlText ?? "SELECT 1 AS valor",
      parameters: JSON.stringify(query?.parameters ?? [], null, 2),
    });
    setTestValues("{}");
    setPreview(undefined);
  }, [query, form, open]);

  useEffect(() => {
    setPreview((current) => current?.draftKey === currentDraftKey ? current : undefined);
  }, [currentDraftKey]);

  const submit = async (values: QueryForm) => {
    if (savePendingRef.current || saving || testing) return;
    if (!preview || preview.draftKey !== currentDraftKey) {
      toast.error("Teste a definição atual e revise a prévia antes de salvar.");
      return;
    }
    const canSave = activeQuery
      ? hasPermission("queries:update")
      : hasPermission("queries:create");
    if (!canSave) {
      toast.error("Você não tem permissão para salvar esta query.");
      return;
    }
    await runSave(async () => {
    try {
      const body = {
        ...values,
        parameters: parseParameters(values.parameters),
        testRunId: preview.testRunId,
      };
      const saved = await persist(
        activeQuery?.id,
        body,
        preview.intent.queryUpdatedAt ?? activeQuery?.updatedAt,
      );
      setCreatedQuery(saved);
      setReloadedQuery(undefined);
      setPreview(undefined);
      toast.success(
        activeQuery
          ? "Query atualizada."
          : "Query criada. Copie o UUID para usar no dashboard.",
      );
      await onSaved();
      if (query) onOpenChange(false);
    } catch (reason) {
      if (isConflict(reason)) {
        if (activeQuery) {
          const latest = await reloadOnConflict(activeQuery.id);
          if (latest) {
            setReloadedQuery(latest);
            form.reset({
              dataSourceId: latest.dataSourceId,
              name: latest.name,
              sqlText: latest.sqlText,
              parameters: JSON.stringify(latest.parameters, null, 2),
            });
          }
        }
        setPreview(undefined);
        toast.error(activeQuery
          ? "A query mudou desde a prévia. Recarreguei a versão atual; revise e teste novamente."
          : "A prévia expirou ou o servidor mudou. Teste novamente antes de salvar.");
      } else {
        toast.error(errorMessage(reason, "A operação falhou."));
      }
    }
    });
  };

  const test = async () => {
    setTesting(true);
    try {
      const values = z
        .object({
          dataSourceId: z.string().uuid("Selecione o servidor PostgreSQL."),
          sqlText: z.string().trim().min(8, "Informe uma consulta SELECT."),
          parameters: z.string().min(2, "Informe um array JSON de parâmetros."),
        })
        .parse(form.getValues());
      const parameters = parseParameters(values.parameters);
      const testValueRecord = parseTestValues(testValues);
      const result = await api.testQueryDraft({
        dataSourceId: values.dataSourceId,
        sqlText: values.sqlText,
        parameters,
        values: testValueRecord,
        mode: activeQuery ? "update" : "create",
        ...(activeQuery ? {
          queryId: activeQuery.id,
          expectedUpdatedAt: activeQuery.updatedAt,
        } : {}),
      });
      setPreview({ ...result, draftKey: currentDraftKey });
      toast.success("Query executada com sucesso.");
    } catch (reason) {
      const text = errorMessage(reason, "A operação falhou.");
      setPreview(undefined);
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
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!saving) onOpenChange(nextOpen); }}>
      <DialogContent className="flex h-[90vh] max-h-[900px] w-[calc(100%-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="border-b p-6">
          <DialogTitle>
            {activeQuery ? "Editar query" : "Nova query"}
          </DialogTitle>
          <DialogDescription>
            Salve uma consulta SELECT parametrizada. A lista vazia de usuários
            libera execução somente para administradores.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          <Form {...form}>
            <form
              id="query-form"
              onSubmit={form.handleSubmit(submit)}
              className="flex flex-col gap-6 p-6"
            >
              <QueryFormFields form={form} sources={sources} saving={saving} />

              <Card>
                <CardHeader>
                  <CardTitle>Testar query</CardTitle>
                  <CardDescription>
                    O teste usa a definição atual do formulário, mesmo antes de
                    salvar.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Textarea
                    value={testValues}
                    onChange={(event) => setTestValues(event.target.value)}
                    spellCheck={false}
                    aria-label="Valores para teste em JSON"
                    disabled={saving}
                  />
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void test()}
                      disabled={testing || saving}
                    >
                      {testing ? (
                        "Testando…"
                      ) : (
                        <>
                          <FileCode2 /> Testar query
                        </>
                      )}
                    </Button>
                  </div>
                  {preview && preview.draftKey === currentDraftKey && <QueryPreviewPanel preview={preview} sources={sources} name={watchedName} />}
                </CardContent>
              </Card>

              {activeQuery && (
                <Card>
                  <CardHeader>
                    <CardTitle>UUID da query</CardTitle>
                    <CardDescription>
                      Use este ID nos componentes, opções e mapeamentos de
                      parâmetros do dashboard.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between gap-3">
                    <code className="break-all text-xs">{activeQuery.id}</code>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => void copyId()}
                    >
                      <Clipboard />
                      <span className="sr-only">Copiar UUID</span>
                    </Button>
                  </CardContent>
                </Card>
              )}
            </form>
          </Form>
        </ScrollArea>
        <DialogFooter className="flex-row justify-end gap-2 border-t bg-popover p-6">
          <Button
            variant="outline"
            type="button"
            onClick={() => { if (!saving) onOpenChange(false); }}
            disabled={saving}
          >
            Fechar
          </Button>
          <Button
            form="query-form"
            type="submit"
            disabled={saving || testing || !preview || preview.draftKey !== currentDraftKey || (activeQuery ? !hasPermission("queries:update") : !hasPermission("queries:create"))}
          >
            {saving ? "Salvando…" : <><Save /> {activeQuery ? "Aplicar edição" : "Salvar nova query"}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
