import { useEffect, useState } from "react";
import { queriesApi } from "@/modules/queries/api/queries.api";
import type { QueryParameter, SavedQuery } from "@/modules/queries/model/types";
import { lineDiff, type DiffLine } from "@/modules/ai/model/text-diff";
import { cn } from "@/shared/lib/utils";

const prefix: Record<DiffLine["kind"], string> = {
  same: "  ",
  added: "+ ",
  removed: "- ",
};

function DiffBlock({ title, lines }: { title: string; lines: DiffLine[] }) {
  return (
    <div className="rounded border p-3">
      <p className="font-medium">{title}</p>
      <pre className="mt-2 max-h-56 overflow-auto font-mono text-xs">
        {lines.map((line, index) => (
          <div
            key={index}
            className={cn(
              "whitespace-pre-wrap break-all",
              line.kind === "added" &&
                "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
              line.kind === "removed" &&
                "bg-destructive/10 text-destructive line-through decoration-destructive/40",
            )}
          >
            {prefix[line.kind]}
            {line.text}
          </div>
        ))}
      </pre>
    </div>
  );
}

// Chaves ordenadas: a mesma definição com outra ordem não é uma alteração.
const sortKeys = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, sortKeys(item)]),
        )
      : value;
const json = (value: unknown) => JSON.stringify(sortKeys(value), null, 2);

/** Compara a versão salva da query com a proposta da IA (modo edição). */
export function QueryChangeDiff({
  queryId,
  name,
  sqlText,
  parameters,
}: {
  queryId: string;
  name: string;
  sqlText: string;
  parameters: QueryParameter[];
}) {
  const [current, setCurrent] = useState<SavedQuery>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    queriesApi
      .savedQuery(queryId)
      .then((query) => active && setCurrent(query))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [queryId]);

  if (failed)
    return (
      <p className="text-xs text-muted-foreground">
        Não foi possível carregar a versão atual para comparar.
      </p>
    );
  if (!current)
    return (
      <p className="text-xs text-muted-foreground">
        Carregando a versão atual…
      </p>
    );

  const nameChanged = current.name !== name.trim();
  const sqlChanged = current.sqlText !== sqlText;
  const paramsChanged = json(current.parameters) !== json(parameters);
  if (!nameChanged && !sqlChanged && !paramsChanged)
    return (
      <p className="rounded border p-3 text-xs text-muted-foreground">
        Nenhuma diferença em nome, SQL ou parâmetros em relação à versão salva.
      </p>
    );
  return (
    <section className="space-y-3">
      <p className="font-medium">Alterações em relação à versão salva</p>
      {nameChanged && (
        <DiffBlock title="Nome" lines={lineDiff(current.name, name.trim())} />
      )}
      {sqlChanged && (
        <DiffBlock title="SQL" lines={lineDiff(current.sqlText, sqlText)} />
      )}
      {paramsChanged && (
        <DiffBlock
          title="Parâmetros"
          lines={lineDiff(json(current.parameters), json(parameters))}
        />
      )}
    </section>
  );
}
