import type { DataSource } from "@/types";
import type { ReviewedQueryPreview } from "./queryForm";

export function QueryPreviewPanel({ preview, sources, name }: { preview: ReviewedQueryPreview; sources: DataSource[]; name: string }) {
  return (
      <div className="flex flex-col gap-3 border bg-muted/40 p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">
            Prévia de {preview.intent.mode === "update" ? "edição" : "nova query"} · {sources.find((source) => source.id === preview.dataSource.id)?.name ?? preview.dataSource.name}
          </p>
          <span className="text-muted-foreground">
            {preview.rowCount}/{preview.rowLimit} linhas · {preview.bytes}/{preview.byteLimit} bytes
            {preview.truncated ? ` · truncada (${preview.truncationReason})` : ""}
          </span>
        </div>
        <p><strong>Nome:</strong> {name}</p>
        <div>
          <p className="mb-1 font-medium">SQL testado</p>
          <pre className="max-h-40 overflow-auto border bg-background p-2 font-mono">{preview.sqlText}</pre>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-1 font-medium">Parâmetros</p>
            <pre className="max-h-28 overflow-auto border bg-background p-2">{JSON.stringify(preview.parameters, null, 2)}</pre>
          </div>
          <div>
            <p className="mb-1 font-medium">Valores usados no teste</p>
            <pre className="max-h-28 overflow-auto border bg-background p-2">{JSON.stringify(preview.testValues, null, 2)}</pre>
          </div>
        </div>
        <div>
          <p className="mb-1 font-medium">Amostra retornada</p>
          <pre className="max-h-48 overflow-auto border bg-background p-2">{JSON.stringify(preview.rows, null, 2)}</pre>
        </div>
        <p className="text-muted-foreground">
          O teste não salva valores dos parâmetros. Confirme esta definição para gravar a query.
        </p>
      </div>
  );
}
