import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { gridMetrics } from "@/modules/dashboards/model/grid";
import { placeComponents } from "@/modules/dashboards/model/grid-placement";
import type { DashboardComponent } from "@/modules/dashboards/model/types";

/**
 * Grade de Células quadradas (ADR 0003): o número de colunas é o que cabe na
 * largura do contêiner e os Componentes se encaixam na ordem da lista.
 */
export function DashboardGrid({
  components,
  renderComponent,
  empty,
}: {
  components: DashboardComponent[];
  renderComponent: (component: DashboardComponent) => ReactNode;
  empty?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const { columns, cellSize, gap } = gridMetrics(width);
  const placements = useMemo(
    () =>
      placeComponents(
        components.map((item) => item.layoutProps),
        columns,
      ),
    [components, columns],
  );

  return (
    <div ref={containerRef} className="w-full">
      {components.length === 0 ? (
        empty
      ) : (
        <div
          className="grid justify-center"
          style={{
            gridTemplateColumns: `repeat(${String(columns)}, ${String(cellSize)}px)`,
            gridAutoRows: `${String(cellSize)}px`,
            gap,
          }}
        >
          {components.map((component, index) => {
            const place = placements[index];
            if (!place) return null;
            return (
              <div
                key={component.id}
                className="grid min-h-0 min-w-0 *:min-h-0 *:min-w-0 *:overflow-hidden"
                style={{
                  gridColumn: `${String(place.col)} / span ${String(place.colSpan)}`,
                  gridRow: `${String(place.row)} / span ${String(place.rowSpan)}`,
                }}
              >
                {renderComponent(component)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
