import { useEffect, useRef, type KeyboardEvent } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import { MAX_MESSAGE_CHARACTERS } from "@/modules/ai/model/chat-items";

export function ChatComposer({
  busy,
  draft,
  onDraftChange,
  onSend,
  onStop,
}: {
  busy: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
  }, [draft]);

  const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      if (!busy && draft.trim()) onSend();
    }
  };

  return (
      <div className="shrink-0 border-t p-3">
        <div className="flex items-end gap-2 border bg-background p-2 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/40">
          <Textarea
            ref={textareaRef}
            value={draft}
            rows={1}
            maxLength={MAX_MESSAGE_CHARACTERS}
            placeholder="Pergunte sobre seus dados…"
            className="max-h-36 min-h-9 resize-none border-0 bg-transparent px-1 py-2 shadow-none my-auto focus-visible:ring-0"
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={submitOnEnter}
            aria-label="Mensagem para a IA"
          />
          {busy ? (
            <Button
              variant="destructive"
              size="icon"
              onClick={onStop}
              aria-label="Parar geração"
              title="Parar geração"
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={onSend}
              disabled={!draft.trim()}
              aria-label="Enviar mensagem"
              title="Enviar mensagem"
            >
              <Send />
            </Button>
          )}
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Enter envia · Shift+Enter quebra linha
        </p>
      </div>
  );
}
