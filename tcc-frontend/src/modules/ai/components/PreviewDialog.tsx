import type { ComponentProps } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { DashboardFilters } from "@/modules/dashboards/components/DashboardFilters";
import { DashboardProposalCanvas } from "@/modules/dashboards/components/DashboardProposalCanvas";
import type { DashboardFilterValues } from "@/modules/dashboards/model/types";
import type {
  DashboardPreviewItem,
  DashboardPreviewQuery,
} from "@/modules/ai/model/chat-items";

export function PreviewDialog({
  item,
  busy,
  isLatestInteraction,
  onApply,
  previewOpen,
  setPreviewOpen,
  acknowledgedLimit,
  setAcknowledgedLimit,
  expired,
  testedQueries,
  testedIssues,
  testingPreview,
  previewTestError,
  initialPreviewFilters,
  previewComponents,
  requiredArguments,
  runPreviewTest,
  onPreviewValuesChange,
  previewQueries,
  previewLookupData,
  truncated,
  truncationDetails,
  interactiveTestFailed,
  unavailable,
}: {
  item: DashboardPreviewItem;
  busy: boolean;
  isLatestInteraction: boolean;
  onApply: (acknowledgeTruncation: boolean) => void;
  previewOpen: boolean;
  setPreviewOpen: (open: boolean) => void;
  acknowledgedLimit: boolean;
  setAcknowledgedLimit: (value: boolean) => void;
  expired: boolean;
  testedQueries: Record<string, DashboardPreviewQuery> | undefined;
  testedIssues: string[] | undefined;
  testingPreview: boolean;
  previewTestError: string | undefined;
  initialPreviewFilters: DashboardFilterValues;
  previewComponents: DashboardPreviewItem["definition"]["components"];
  requiredArguments: ComponentProps<typeof DashboardFilters>["parameters"];
  runPreviewTest: (values: DashboardFilterValues) => Promise<void>;
  onPreviewValuesChange: () => void;
  previewQueries: Record<string, DashboardPreviewQuery>;
  previewLookupData: ComponentProps<typeof DashboardFilters>["lookupData"];
  truncated: boolean;
  truncationDetails: {
    label: string;
    queryId: string;
    query: DashboardPreviewQuery;
  }[];
  interactiveTestFailed: boolean;
  unavailable: boolean;
}) {
  return (
    <Dialog
      open={previewOpen && !item.saved && isLatestInteraction}
      onOpenChange={setPreviewOpen}
    >
      <DialogContent className="flex h-[86dvh] max-h-[90dvh] w-[calc(100%-1rem)] max-w-5xl flex-col overflow-hidden p-4 sm:w-[88vw] sm:max-w-5xl sm:p-6">
        <DialogHeader className="shrink-0 border-b pb-4 pr-8 text-left">
          <DialogTitle className="text-xl">
            Prévia visual dos componentes propostos
          </DialogTitle>
          <DialogDescription>
            Teste os filtros necessários e veja como os componentes serão
            exibidos no dashboard antes de aplicar as alterações.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto py-1 pr-1">
          {previewComponents.length > 0 ? (
            <section className="space-y-3 rounded border bg-muted/20 p-3">
              <div>
                <h3 className="text-sm font-medium">Testar filtros</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Os valores são usados apenas para executar esta amostra; não
                  alteram nem salvam filtros no dashboard.
                </p>
              </div>
              <DashboardFilters
                parameters={requiredArguments}
                lookupData={previewLookupData}
                appliedFilters={initialPreviewFilters}
                onApply={runPreviewTest}
                onValuesChange={onPreviewValuesChange}
                heading="Filtros obrigatórios"
                description="Os valores são usados apenas para executar esta amostra; não alteram nem salvam filtros no dashboard."
                submitLabel={
                  testingPreview ? "Testando…" : "Testar componentes"
                }
                submitIcon={
                  testingPreview ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <RefreshCw />
                  )
                }
                submitDisabled={testingPreview || busy || expired || item.stale}
                showWhenEmpty
                emptyMessage="Não há filtros obrigatórios para os componentes adicionados."
              />
              {previewTestError && (
                <p role="alert" className="text-xs text-destructive">
                  {previewTestError}
                </p>
              )}
              {testedIssues && testedIssues.length > 0 && (
                <p role="alert" className="text-xs text-destructive">
                  A proposta não pode ser aplicada: {testedIssues.join(" ")}
                </p>
              )}
              {testedQueries && !interactiveTestFailed && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  Amostra carregada para os componentes propostos. Revise os
                  resultados abaixo antes de aplicar.
                </p>
              )}
            </section>
          ) : (
            <p className="rounded border bg-muted/20 p-3 text-sm text-muted-foreground">
              Esta proposta não adiciona componentes novos. Consulte o resumo
              das alterações abaixo.
            </p>
          )}

          {previewComponents.length > 0 &&
            testedQueries &&
            Object.values(testedQueries).some((query) => query.error) && (
              <div
                role="alert"
                className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                O teste encontrou erros. Revise os valores dos filtros e tente
                novamente.
              </div>
            )}

          {item.issues.length > 0 && (
            <div
              role="alert"
              className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              <p className="font-medium">
                A prévia encontrou problemas que precisam de ajuste
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {item.issues.map((issue, index) => (
                  <li key={`${index}-${issue}`}>{issue}</li>
                ))}
              </ul>
            </div>
          )}

          {previewComponents.length > 0 && truncated && (
            <div className="border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
              <p className="font-medium">Amostra limitada</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                {truncationDetails.map(({ label, queryId, query }, index) => (
                  <li key={`${label}-${queryId}-${index}`}>
                    {label} · query {queryId.slice(0, 8)}…: {query.rows.length}/
                    {query.rowLimit} linhas · {query.bytes}/{query.byteLimit}{" "}
                    bytes ({query.truncationReason}).
                  </li>
                ))}
              </ul>
            </div>
          )}

          {previewComponents.length > 0 && (
            <DashboardProposalCanvas
              definition={item.definition}
              rowsByQuery={previewQueries}
              componentIds={item.previewComponentIds}
              componentChanges={item.componentChanges}
            />
          )}

          <section className="space-y-2 border-t pt-4 text-sm">
            <h3 className="font-medium">Resumo das alterações</h3>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {item.changeSummary.map((change, index) => (
                <li key={`${index}-${change}`}>{change}</li>
              ))}
            </ul>
          </section>
        </div>

        {truncated && (
          <Label className="flex shrink-0 items-start gap-2 border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
            <Checkbox
              checked={acknowledgedLimit}
              onCheckedChange={(checked) =>
                setAcknowledgedLimit(checked === true)
              }
            />
            <span>
              Entendo que os componentes foram avaliados com uma amostra
              limitada.
            </span>
          </Label>
        )}

        <DialogFooter className="shrink-0 border-t pt-3">
          {item.saved ? (
            <span className="mr-auto text-sm text-emerald-700 dark:text-emerald-400">
              Dashboard salvo.
            </span>
          ) : item.stale || expired ? (
            <span className="mr-auto text-sm text-muted-foreground">
              Prévia expirada ou desatualizada. Gere uma nova proposta.
            </span>
          ) : (
            <span className="mr-auto text-sm text-muted-foreground">
              A proposta só será aplicada após sua confirmação.
            </span>
          )}
          {!item.saved && isLatestInteraction && (
            <Button
              disabled={unavailable}
              onClick={() => onApply(acknowledgedLimit)}
            >
              {item.saving
                ? "Salvando…"
                : item.mode === "create"
                  ? "Criar dashboard"
                  : "Aplicar alterações"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
