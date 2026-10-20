import type { QueryPreviewItem } from "@/modules/ai/model/chat-items";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

export function ReviewPreviewDialog({
  reviewPreview,
  setReviewPreview,
  savingPreview,
  reviewName,
  setReviewName,
  stalePreview,
  reloadedQuery,
  canSavePreview,
  busy,
  savePreview,
}: {
  reviewPreview?: QueryPreviewItem;
  setReviewPreview: (item: QueryPreviewItem | undefined) => void;
  savingPreview: boolean;
  reviewName: string;
  setReviewName: (name: string) => void;
  stalePreview: boolean;
  reloadedQuery?: { name: string; sqlText: string };
  canSavePreview: boolean;
  busy: boolean;
  savePreview: () => Promise<void>;
}) {
  return (
    <Dialog
      open={Boolean(reviewPreview)}
      onOpenChange={(open) => {
        if (!open && !savingPreview) setReviewPreview(undefined);
      }}
    >
      <DialogContent className="flex max-h-[90vh] w-[90vw] max-w-[90vw] flex-col overflow-hidden sm:max-w-[90vw]">
        <DialogHeader>
          <DialogTitle>
            {reviewPreview?.purpose === "dashboard"
              ? "Revisar query para dashboard"
              : "Revisar consulta rápida"}
          </DialogTitle>
          <DialogDescription>
            Confirme o servidor, a ação, os valores usados e a amostra.{" "}
            {reviewPreview?.purpose === "dashboard"
              ? "Ao salvar, o assistente continuará a proposta de dashboard solicitada."
              : "Ao salvar, esta query ficará disponível no catálogo; isso não inicia automaticamente uma proposta de dashboard."}{" "}
            A resposta em texto da IA não confirma nenhuma alteração.
          </DialogDescription>
        </DialogHeader>
        {reviewPreview && (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-2 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <p>
                <strong>Servidor:</strong> {reviewPreview.dataSource.name}
              </p>
              <p>
                <strong>Ação:</strong>{" "}
                {reviewPreview.intent.mode === "update"
                  ? `Editar ${reviewPreview.intent.queryId}`
                  : "Criar query"}
              </p>
            </div>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Nome da query
              <Input
                value={reviewName}
                maxLength={160}
                minLength={2}
                onChange={(event) => setReviewName(event.target.value)}
                disabled={savingPreview}
              />
            </label>
            <div className="rounded border bg-muted/40 p-3">
              <p className="font-medium">SQL testado</p>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">
                {reviewPreview.sqlText}
              </pre>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded border p-3">
                <p className="font-medium">Definições dos parâmetros</p>
                <pre className="mt-2 max-h-36 overflow-auto text-xs">
                  {JSON.stringify(reviewPreview.parameters, null, 2)}
                </pre>
              </div>
              <div className="rounded border p-3">
                <p className="font-medium">Valores usados no teste</p>
                <pre className="mt-2 max-h-36 overflow-auto text-xs">
                  {JSON.stringify(reviewPreview.testValues, null, 2)}
                </pre>
              </div>
            </div>
            <div className="rounded border p-3">
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-medium">
                  Amostra retornada · {reviewPreview.rowCount} linhas
                </p>
                <p className="text-xs text-muted-foreground">
                  Limite {reviewPreview.rowLimit} linhas /{" "}
                  {reviewPreview.byteLimit} bytes · {reviewPreview.bytes} bytes
                  usados
                  {reviewPreview.truncated
                    ? ` · truncada (${reviewPreview.truncationReason})`
                    : ""}
                </p>
              </div>
              <pre className="mt-2 max-h-56 overflow-auto text-xs">
                {JSON.stringify(reviewPreview.rows, null, 2)}
              </pre>
            </div>
            {stalePreview && (
              <div
                role="alert"
                className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                Esta prévia não pode mais ser usada. Teste novamente antes de
                salvar.
                {reloadedQuery && (
                  <>
                    <p className="mt-2 font-medium">
                      Versão atual recarregada: {reloadedQuery.name}
                    </p>
                    <pre className="mt-1 max-h-24 overflow-auto text-xs">
                      {reloadedQuery.sqlText}
                    </pre>
                  </>
                )}
              </div>
            )}
            {!canSavePreview && (
              <p className="text-xs text-muted-foreground">
                Sua conta não tem a permissão necessária para salvar esta query.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setReviewPreview(undefined)}
            disabled={savingPreview}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => void savePreview()}
            disabled={
              !reviewPreview ||
              savingPreview ||
              busy ||
              stalePreview ||
              !canSavePreview ||
              reviewName.trim().length < 2
            }
          >
            {savingPreview
              ? "Salvando…"
              : reviewPreview?.purpose === "dashboard"
                ? reviewPreview.intent.mode === "update"
                  ? "Aplicar e continuar"
                  : "Salvar e continuar"
                : reviewPreview?.intent.mode === "update"
                  ? "Aplicar edição"
                  : "Salvar query"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
