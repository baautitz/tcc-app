import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { DEFAULT_AI_CHAT_WIDTH, MAX_AI_CHAT_WIDTH, MIN_AI_CHAT_WIDTH } from "./chat-items";

export const clampWidth = (w: number) =>
  Math.max(MIN_AI_CHAT_WIDTH, Math.min(MAX_AI_CHAT_WIDTH, w));

/** Next width for a resize key, or undefined if the key is not handled. */
export function widthForKey(key: string, shift: boolean, width: number) {
  const step = shift ? 32 : 16;
  if (key === "ArrowLeft") return clampWidth(width + step);
  if (key === "ArrowRight") return clampWidth(width - step);
  if (key === "Home") return MIN_AI_CHAT_WIDTH;
  if (key === "End") return MAX_AI_CHAT_WIDTH;
  return undefined;
}

export function useChatResize() {
  const [panelWidth, setPanelWidth] = useState(DEFAULT_AI_CHAT_WIDTH);
  const startRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  const begin = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    startRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: panelWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setPanelWidth(clampWidth(start.startWidth + start.startX - event.clientX));
  };
  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (startRef.current?.pointerId !== event.pointerId) return;
    startRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = widthForKey(event.key, event.shiftKey, panelWidth);
    if (next === undefined) return;
    event.preventDefault();
    setPanelWidth(next);
  };
  return { panelWidth, begin, move, end, onKeyDown };
}
