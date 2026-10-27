import {
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { gridMetrics } from "@/modules/dashboards/model/grid";
import {
  expandPlacements,
  placeComponents,
} from "@/modules/dashboards/model/grid-placement";
import {
  dropIndex,
  moveItem,
  resizeSpans,
} from "@/modules/dashboards/model/grid-edit";
import { useElementWidth } from "./useElementWidth";
import type { DashboardComponent } from "@/modules/dashboards/model/types";

/**
 * Grade de Células quadradas (ADR 0003): o número de colunas é o que cabe na
 * largura do contêiner e os Componentes se encaixam na ordem da lista.
 */
export function DashboardGrid({
  components,
  renderComponent,
  empty,
  onEdit,
}: {
  components: DashboardComponent[];
  renderComponent: (component: DashboardComponent) => ReactNode;
  empty?: ReactNode;
  /** Liga o modo edição: arrastar reordena, as alças redimensionam. Mostra os tamanhos mínimos. */
  onEdit?: (components: DashboardComponent[]) => void;
}) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();

  const { columns, cellSize, gap } = gridMetrics(width);
  const placements = useMemo(
    () =>
      ((placed) => (onEdit ? placed : expandPlacements(placed, columns)))(
        placeComponents(
          components.map((item) => item.layoutProps),
          columns,
        ),
      ),
    [components, columns, onEdit],
  );
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: string;
    mode: "move" | "resize";
    axes: { x: boolean; y: boolean };
    startX: number;
    startY: number;
    start: { colSpan: number; rowSpan: number };
  } | null>(null);
  const [activeId, setActiveId] = useState<string>();
  const step = cellSize + gap;

  const dragProps = (
    component: DashboardComponent,
    mode: "move" | "resize",
    axes = { x: true, y: true },
  ) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        id: component.id,
        mode,
        axes,
        startX: event.clientX,
        startY: event.clientY,
        start: { ...component.layoutProps },
      };
      setActiveId(component.id);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      const rect = gridRef.current?.getBoundingClientRect();
      if (!drag || !rect || !onEdit) return;
      if (drag.mode === "move") {
        const col = Math.min(
          columns,
          Math.max(1, Math.floor((event.clientX - rect.left) / step) + 1),
        );
        const row = Math.max(
          1,
          Math.floor((event.clientY - rect.top) / step) + 1,
        );
        const others = components.filter((item) => item.id !== drag.id);
        const index = dropIndex(
          others.map((item) => item.layoutProps),
          columns,
          col,
          row,
        );
        const next = moveItem(components, drag.id, index);
        if (next.some((item, position) => item !== components[position]))
          onEdit(next);
        return;
      }
      const size = resizeSpans(
        drag.start,
        drag.axes.x ? Math.round((event.clientX - drag.startX) / step) : 0,
        drag.axes.y ? Math.round((event.clientY - drag.startY) / step) : 0,
      );
      const current = components.find((item) => item.id === drag.id);
      if (
        current &&
        (current.layoutProps.colSpan !== size.colSpan ||
          current.layoutProps.rowSpan !== size.rowSpan)
      )
        onEdit(
          components.map((item) =>
            item.id === drag.id ? { ...item, layoutProps: size } : item,
          ),
        );
    },
    onPointerUp: () => {
      dragRef.current = null;
      setActiveId(undefined);
    },
  });

  return (
    <div ref={containerRef} className="w-full">
      {components.length === 0 ? (
        empty
      ) : (
        <div
          ref={gridRef}
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
                className={`relative grid min-h-0 min-w-0 *:min-h-0 *:min-w-0 *:overflow-hidden ${
                  onEdit
                    ? `outline-2 outline-offset-2 ${activeId === component.id ? "outline-primary" : "outline-primary/30"}`
                    : ""
                }`}
                style={{
                  gridColumn: `${String(place.col)} / span ${String(place.colSpan)}`,
                  gridRow: `${String(place.row)} / span ${String(place.rowSpan)}`,
                }}
              >
                {renderComponent(component)}
                {onEdit && (
                  <>
                    <div
                      className="absolute inset-0 z-10 cursor-grab touch-none active:cursor-grabbing"
                      aria-label={`Mover ${component.title}`}
                      {...dragProps(component, "move")}
                    />
                    <div
                      className="absolute top-2 right-0 bottom-2 z-20 w-2 cursor-ew-resize touch-none bg-primary/40"
                      aria-label={`Ajustar largura de ${component.title}`}
                      {...dragProps(component, "resize", { x: true, y: false })}
                    />
                    <div
                      className="absolute right-2 bottom-0 left-2 z-20 h-2 cursor-ns-resize touch-none bg-primary/40"
                      aria-label={`Ajustar altura de ${component.title}`}
                      {...dragProps(component, "resize", { x: false, y: true })}
                    />
                    <div
                      className="absolute right-0 bottom-0 z-30 size-4 cursor-nwse-resize touch-none bg-primary"
                      aria-label={`Ajustar tamanho de ${component.title}`}
                      {...dragProps(component, "resize")}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
