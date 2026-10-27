import { Eye } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Label } from "@/shared/ui/label";
import { type DashboardPreviewItem } from "@/modules/ai/model/chat-items";
import { PreviewDialog } from "@/modules/ai/components/PreviewDialog";
import { useDashboardPreview } from "@/modules/ai/hooks/useDashboardPreview";

export function DashboardPreviewCard({
  item,
  busy,
  isLatestInteraction,
  onApply,
}: {
  item: DashboardPreviewItem;
  busy: boolean;
  isLatestInteraction: boolean;
  onApply: (acknowledgeTruncation: boolean) => void;
}) {
  const {
    acknowledgedLimit,
    setAcknowledgedLimit,
    expired,
    setPreviewOpen,
    testedQueries,
    testedIssues,
    componentTitles,
    componentChangeSummary,
    queryCount,
    pendingPreviewCount,
    failedPreviewCount,
    truncated,
    unavailable,
    previewOpen,
    testingPreview,
    previewTestError,
    initialPreviewFilters,
    previewComponents,
    requiredArguments,
    runPreviewTest,
    onPreviewValuesChange,
    previewQueries,
    previewLookupData,
    truncationDetails,
    interactiveTestFailed,
  } = useDashboardPreview(item, busy, isLatestInteraction);
  return (
    <>
      <section className="@container mx-3 flex min-w-0 flex-col gap-3 border border-primary/30 bg-primary/5 p-3 text-sm sm:mx-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              {item.mode === "create"
                ? "Prévia de novo dashboard"
                : "Proposta de alterações"}
            </p>
            <h3 className="mt-1 break-words text-base font-semibold">
              {item.document.name}
            </h3>
            {componentTitles.length > 0 && (
              <p className="mt-1 break-words text-xs font-medium">
                {componentTitles.join(" · ")}
              </p>
            )}
            {componentTitles.length === 0 && componentChangeSummary && (
              <p className="mt-1 break-words text-xs font-medium">
                {componentChangeSummary}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {componentTitles.length > 0
                ? `${componentTitles.length} componentes na prévia · ${queryCount} queries`
                : "Nenhuma prévia de dados necessária"}
              {failedPreviewCount > 0 &&
                ` · ${failedPreviewCount} falhas na prévia`}
              {pendingPreviewCount > 0 &&
                ` · ${pendingPreviewCount} aguardando filtros`}
            </p>
          </div>
          {isLatestInteraction && !item.saved && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setPreviewOpen(true)}
            >
              <Eye />
              Visualizar
            </Button>
          )}
        </div>

        {item.changeSummary.length > 0 && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {item.changeSummary.join(" ")}
          </p>
        )}
        {item.issues.length > 0 && (
          <p className="text-xs text-destructive">
            {item.issues.length} problema(s) na prévia.{" "}
            {isLatestInteraction
              ? "Abra Visualizar para revisar antes de ajustar."
              : "Peça uma nova proposta para revisar e ajustar."}
          </p>
        )}
        {testedIssues && testedIssues.length > 0 && (
          <p role="alert" className="text-xs text-destructive">
            Teste da prévia encontrou problemas; corrija a proposta antes de
            aplicar.
          </p>
        )}
        {pendingPreviewCount > 0 && !testedQueries && (
          <p className="text-xs text-muted-foreground">
            Preencha os filtros obrigatórios e teste os componentes antes de
            aplicar as alterações.
          </p>
        )}

        {truncated && (
          <Label className="flex min-w-0 items-start gap-2 border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
            <Checkbox
              className="shrink-0"
              checked={acknowledgedLimit}
              onCheckedChange={(checked) =>
                setAcknowledgedLimit(checked === true)
              }
            />
            <span className="min-w-0 break-words">
              A amostra está limitada. Revise os detalhes no modo de
              visualização antes de confirmar.
            </span>
          </Label>
        )}

        <footer className="flex min-w-0 flex-col gap-2 border-t border-primary/15 pt-3 @md:flex-row @md:items-center @md:justify-between">
          {item.saved ? (
            <span className="min-w-0 text-xs text-emerald-700 dark:text-emerald-400">
              Dashboard salvo.
            </span>
          ) : item.stale || expired ? (
            <span className="min-w-0 text-xs text-muted-foreground">
              Prévia expirada ou desatualizada. Gere uma nova proposta.
            </span>
          ) : (
            <span className="min-w-0 text-xs text-muted-foreground">
              Nenhuma alteração é aplicada antes de confirmar.
            </span>
          )}
          {!item.saved && isLatestInteraction && (
            <Button
              size="sm"
              className="w-full @md:w-auto @md:shrink-0"
              disabled={unavailable}
              onClick={() => onApply(acknowledgedLimit)}
            >
              {item.saving
                ? "Salvando…"
                : item.mode === "create"
                  ? "Criar dashboard"
                  : `Aplicar alterações em ${item.document.name}`}
            </Button>
          )}
        </footer>
      </section>

      <PreviewDialog
        item={item}
        busy={busy}
        isLatestInteraction={isLatestInteraction}
        onApply={onApply}
        previewOpen={previewOpen}
        setPreviewOpen={setPreviewOpen}
        acknowledgedLimit={acknowledgedLimit}
        setAcknowledgedLimit={setAcknowledgedLimit}
        expired={expired}
        testedQueries={testedQueries}
        testedIssues={testedIssues}
        testingPreview={testingPreview}
        previewTestError={previewTestError}
        initialPreviewFilters={initialPreviewFilters}
        previewComponents={previewComponents}
        requiredArguments={requiredArguments}
        runPreviewTest={runPreviewTest}
        onPreviewValuesChange={onPreviewValuesChange}
        previewQueries={previewQueries}
        previewLookupData={previewLookupData}
        truncated={truncated}
        truncationDetails={truncationDetails}
        interactiveTestFailed={interactiveTestFailed}
        unavailable={unavailable}
      />
    </>
  );
}
