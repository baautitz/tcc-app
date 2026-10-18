export function errorMessage(reason: unknown, fallback = "A operação falhou."): string {
  return reason instanceof Error ? reason.message || fallback : fallback;
}
