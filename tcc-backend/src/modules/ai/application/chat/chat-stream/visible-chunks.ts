import { AiReasoningFilter } from "../ai-reasoning-filter.js";

/** Strips reasoning blocks from the buffered model text. */
export function buildVisibleChunks(pendingModelText: string[]): string[] {
  const reasoningFilter = new AiReasoningFilter();
  const visibleChunks = pendingModelText
    .map((chunk) => reasoningFilter.push(chunk))
    .filter(Boolean);
  const remainingText = reasoningFilter.finish();
  if (remainingText) visibleChunks.push(remainingText);
  return visibleChunks;
}
