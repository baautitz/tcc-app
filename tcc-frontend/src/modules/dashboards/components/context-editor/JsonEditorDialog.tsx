import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Textarea } from "@/shared/ui/textarea";

export function JsonEditorDialog({
  open,
  saving,
  draft,
  error,
  onDraftChange,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  saving: boolean;
  draft: string;
  error?: string;
  onDraftChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[90vh] max-h-[900px] w-[calc(100%-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl"
      >
        <DialogHeader className="border-b px-6 py-4 pr-14">
          <DialogTitle className="text-base">
            Editar JSON do dashboard
          </DialogTitle>
          <DialogDescription>
            Edite a configuração completa. O JSON será validado e salvo no
            arquivo do dashboard.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 p-4 sm:p-6">
          <Textarea
            aria-label="JSON do dashboard"
            spellCheck={false}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            className="h-full min-h-0 resize-none rounded-md bg-muted/30 p-4 font-mono text-xs leading-5 tab-size-2"
          />
        </div>
        {error && (
          <p role="alert" className="px-6 pb-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter className="border-t px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={onSave} disabled={saving}>
            {saving ? "Validando e salvando…" : "Salvar JSON"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
