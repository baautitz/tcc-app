import type { AiContextProposal } from "@/modules/ai/model/types";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

export function ReviewContextDialog({
  reviewContext,
  setReviewContext,
  resolvingContext,
  resolveContextProposal,
}: {
  reviewContext?: AiContextProposal;
  setReviewContext: (proposal: AiContextProposal | undefined) => void;
  resolvingContext: boolean;
  resolveContextProposal: (action: "approve" | "dismiss") => Promise<void>;
}) {
  return (
      <Dialog
        open={Boolean(reviewContext)}
        onOpenChange={(open) => {
          if (!open && !resolvingContext) setReviewContext(undefined);
        }}
      >
        <DialogContent className="flex max-h-[90dvh] w-[calc(100%-1rem)] max-w-3xl flex-col overflow-hidden sm:w-[calc(100%-2rem)]">
          <DialogHeader>
            <DialogTitle>Revisar alteração de contexto</DialogTitle>
            <DialogDescription>
              Fechar ou cancelar esta janela não aprova nem descarta a proposta.
            </DialogDescription>
          </DialogHeader>
          {reviewContext && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 text-sm">
              <dl className="grid gap-2 rounded border bg-muted/30 p-3 sm:grid-cols-2">
                <div>
                  <dt className="font-medium">Servidor</dt>
                  <dd className="break-words text-muted-foreground">
                    {reviewContext.sourceName}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">Destino</dt>
                  <dd className="break-words text-muted-foreground">
                    {reviewContext.targetType === "source"
                      ? "Contexto geral do servidor"
                      : `${reviewContext.schemaName}.${reviewContext.tableName}`}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-medium">Motivo informado pela IA</dt>
                  <dd className="whitespace-pre-wrap break-words text-muted-foreground">
                    {reviewContext.reason}
                  </dd>
                </div>
              </dl>
              <div className="rounded border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                Este contexto orienta as próximas consultas da IA para{" "}
                {reviewContext.targetType === "source"
                  ? "este servidor"
                  : "esta tabela"}
                . A aprovação altera somente o texto de contexto; não muda
                credenciais, conexão ou dados.
              </div>
              <div className="grid min-w-0 gap-3 md:grid-cols-2">
                <section
                  aria-labelledby="context-current-heading"
                  className="min-w-0 rounded border p-3"
                >
                  <h3 id="context-current-heading" className="font-medium">
                    Contexto atual
                  </h3>
                  <div className="mt-2 max-h-52 min-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-3 text-sm">
                    {reviewContext.currentContext || (
                      <span className="italic text-muted-foreground">
                        Nenhum contexto cadastrado.
                      </span>
                    )}
                  </div>
                </section>
                <section
                  aria-labelledby="context-proposed-heading"
                  className="min-w-0 rounded border border-primary/30 p-3"
                >
                  <h3 id="context-proposed-heading" className="font-medium">
                    Contexto proposto
                  </h3>
                  <div className="mt-2 max-h-52 min-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-primary/5 p-3 text-sm">
                    {reviewContext.proposedContext || (
                      <span className="italic text-muted-foreground">
                        O contexto será removido.
                      </span>
                    )}
                  </div>
                </section>
              </div>
              {reviewContext.status !== "pending" && (
                <p
                  role="status"
                  className="rounded border p-3 text-sm text-muted-foreground"
                >
                  Esta proposta já foi resolvida ({reviewContext.status}). Gere
                  outra proposta se ainda precisar alterar o contexto.
                </p>
              )}
            </div>
          )}
          <DialogFooter className="flex-col-reverse gap-2 border-t pt-3 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => setReviewContext(undefined)}
              disabled={resolvingContext}
            >
              Cancelar
            </Button>
            {reviewContext?.status === "pending" &&
              Date.parse(reviewContext.expiresAt) > Date.now() && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => void resolveContextProposal("dismiss")}
                    disabled={resolvingContext}
                  >
                    {resolvingContext ? "Salvando…" : "Descartar proposta"}
                  </Button>
                  <Button
                    onClick={() => void resolveContextProposal("approve")}
                    disabled={resolvingContext}
                  >
                    {resolvingContext ? "Aprovando…" : "Aprovar contexto"}
                  </Button>
                </>
              )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
