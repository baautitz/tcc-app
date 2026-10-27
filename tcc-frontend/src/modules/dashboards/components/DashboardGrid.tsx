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
  const step = cellSize + gap;
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: string;
    mode: "move" | "resize";
    axes: { x: boolean; y: boolean };
    startX: number;
    startY: number;
    /** Tamanho mostrado ao começar (limitado às colunas visíveis). */
    start: { colSpan: number; rowSpan: number };
    /** Tamanho gravado ao começar; volta a ele se o arrasto terminar no ponto de partida. */
    authored: { colSpan: number; rowSpan: number };
    /** Posição, em px dentro da Grade, do canto do componente ao começar a mover. */
    origin: { left: number; top: number };
  } | null>(null);
  const [activeId, setActiveId] = useState<string>();
  /** Mover só pré-visualiza: a ordem é gravada ao soltar. */
  const [move, setMove] = useState<{
    id: string;
    index: number;
    dx: number;
    dy: number;
    origin: { left: number; top: number };
  } | null>(null);

  // Durante o arrasto a Grade mostra como ficará ao soltar.
  const shown = useMemo(
    () => (move ? moveItem(components, move.id, move.index) : components),
    [components, move],
  );
  const placements = useMemo(
    () =>
      ((placed) => (onEdit ? placed : expandPlacements(placed, columns)))(
        placeComponents(
          shown.map((item) => item.layoutProps),
          columns,
        ),
      ),
    [shown, columns, onEdit],
  );

  const landing = move
    ? placements[shown.findIndex((item) => item.id === move.id)]
    : undefined;

  const dragProps = (
    component: DashboardComponent,
    mode: "move" | "resize",
    axes = { x: true, y: true },
  ) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const place = placements[shown.findIndex((i) => i.id === component.id)];
      dragRef.current = {
        id: component.id,
        mode,
        axes,
        startX: event.clientX,
        startY: event.clientY,
        start: {
          colSpan: place?.colSpan ?? component.layoutProps.colSpan,
          rowSpan: place?.rowSpan ?? component.layoutProps.rowSpan,
        },
        authored: { ...component.layoutProps },
        origin: {
          left: ((place?.col ?? 1) - 1) * step,
          top: ((place?.row ?? 1) - 1) * step,
        },
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
        setMove({
          id: drag.id,
          index: dropIndex(
            others.map((item) => item.layoutProps),
            columns,
            col,
            row,
          ),
          dx: event.clientX - drag.startX,
          dy: event.clientY - drag.startY,
          origin: drag.origin,
        });
        return;
      }
      const moved = resizeSpans(
        drag.start,
        drag.axes.x ? Math.round((event.clientX - drag.startX) / step) : 0,
        drag.axes.y ? Math.round((event.clientY - drag.startY) / step) : 0,
      );
      const size = {
        colSpan: Math.min(moved.colSpan, columns),
        rowSpan: moved.rowSpan,
      };
      const unchanged =
        size.colSpan === drag.start.colSpan &&
        size.rowSpan === drag.start.rowSpan;
      const target = unchanged ? drag.authored : size;
      const current = components.find((item) => item.id === drag.id);
      if (
        current &&
        (current.layoutProps.colSpan !== target.colSpan ||
          current.layoutProps.rowSpan !== target.rowSpan)
      )
        onEdit(
          components.map((item) =>
            item.id === drag.id ? { ...item, layoutProps: target } : item,
          ),
        );
    },
    onPointerUp: () => {
      const drag = dragRef.current;
      if (drag?.mode === "move" && move && onEdit) {
        const next = moveItem(components, move.id, move.index);
        if (next.some((item, position) => item !== components[position]))
          onEdit(next);
      }
      dragRef.current = null;
      setMove(null);
      setActiveId(undefined);
    },
    onPointerCancel: () => {
      dragRef.current = null;
      setMove(null);
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
          {landing && (
            <div
              aria-hidden="true"
              className="rounded-md border-2 border-dashed border-primary bg-primary/10"
              style={{
                gridColumn: `${String(landing.col)} / span ${String(landing.colSpan)}`,
                gridRow: `${String(landing.row)} / span ${String(landing.rowSpan)}`,
              }}
            />
          )}
          {shown.map((component, index) => {
            const place = placements[index];
            if (!place) return null;
            const floating = move?.id === component.id ? move : undefined;
            const origin = floating?.origin;
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
                  ...(floating && origin
                    ? {
                        // Acompanha o cursor, não o espaço onde vai cair.
                        transform: `translate(${String(origin.left + floating.dx - (place.col - 1) * step)}px, ${String(origin.top + floating.dy - (place.row - 1) * step)}px)`,
                        zIndex: 40,
                        opacity: 0.85,
                        boxShadow: "0 8px 24px rgb(0 0 0 / 0.25)",
                      }
                    : {}),
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
