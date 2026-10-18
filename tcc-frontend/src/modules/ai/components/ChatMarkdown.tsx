import {
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Maximize2,
} from "lucide-react";
import {
  Button,
} from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

function ExpandableChatTable({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="my-2 min-w-0">
      <div className="mb-1 flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => setOpen(true)}
        >
          <Maximize2 className="size-3.5" />
          Expandir tabela
        </Button>
      </div>
      {!open && (
        <div
          role="region"
          aria-label="Tabela da resposta da IA"
          tabIndex={0}
          className="w-full overflow-x-auto overscroll-contain rounded border"
        >
          <Table containerClassName="overflow-visible" className="w-max min-w-full">
            {children}
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[80dvh] max-h-[80dvh] w-[80vw] max-w-[80vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[80vw]">
          <DialogHeader className="shrink-0 border-b px-5 py-4">
            <DialogTitle>Tabela da resposta</DialogTitle>
            <DialogDescription>
              Role para ver as demais colunas e linhas.
            </DialogDescription>
          </DialogHeader>
          <div
            role="region"
            aria-label="Tabela expandida da resposta da IA"
            tabIndex={0}
            className="min-h-0 flex-1 overflow-auto overscroll-contain p-4"
          >
            {open && (
              <Table containerClassName="overflow-visible" className="w-max min-w-full">
                {children}
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="text-lg font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold">{children}</h3>,
  p: ({ children }) => (
    <p className="m-0 whitespace-pre-wrap">{children}</p>
  ),
  ul: ({ children }) => <ul className="list-disc space-y-0 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-0 pl-5">{children}</ol>,
  li: ({ children }) => (
    <li className="m-0 leading-normal [&>p]:m-0">{children}</li>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  pre: ({ children }) => (
    <pre className="max-w-full overflow-x-auto rounded bg-background/70 p-3 text-xs">
      {children}
    </pre>
  ),
  code: ({ children, className }) => (
    <code className={className ?? "rounded bg-background/70 px-1 py-0.5 text-xs"}>
      {children}
    </code>
  ),
  table: ({ children }) => <ExpandableChatTable>{children}</ExpandableChatTable>,
  thead: ({ children }) => (
    <TableHeader className="sticky top-0 z-10 bg-muted [&_th]:bg-muted">
      {children}
    </TableHeader>
  ),
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  th: ({ children }) => <TableHead>{children}</TableHead>,
  td: ({ children }) => <TableCell>{children}</TableCell>,
};

export function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 [&_strong]:font-semibold">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
