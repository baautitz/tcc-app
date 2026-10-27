export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

/** Diff por linhas (LCS): o que saiu de `before` e o que entrou em `after`. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const table = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i]![j] =
        a[i] === b[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      result.push({ kind: "removed", text: a[i++]! });
    } else {
      result.push({ kind: "added", text: b[j++]! });
    }
  }
  while (i < a.length) result.push({ kind: "removed", text: a[i++]! });
  while (j < b.length) result.push({ kind: "added", text: b[j++]! });
  return result;
}
