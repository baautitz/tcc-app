import { useCallback, useLayoutEffect, useState } from "react";

/**
 * Largura atual, em px, do elemento ligado ao callback ref devolvido; acompanha
 * redimensionamentos e funciona mesmo quando o elemento aparece só depois.
 */
export function useElementWidth<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  const ref = useCallback((node: T | null) => {
    setElement(node);
    if (node) setWidth(node.clientWidth);
  }, []);
  useLayoutEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element]);
  return [ref, width] as const;
}
