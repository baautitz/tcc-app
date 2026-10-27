import type { CSSProperties } from "react";

/** Tooltip único dos gráficos: compacto, acima da legenda, maiores valores primeiro. */
export const chartTooltipProps = {
  wrapperStyle: { zIndex: 50 } satisfies CSSProperties,
  contentStyle: { padding: "6px 10px", fontSize: 11 } satisfies CSSProperties,
  itemStyle: { padding: 0 } satisfies CSSProperties,
  itemSorter: (item: { value?: unknown }) => -(Number(item.value) || 0),
};
