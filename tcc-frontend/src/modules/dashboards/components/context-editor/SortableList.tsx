import { useState, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/shared/lib/utils";

/** Ids só do cliente, um por item, para o cartão não remontar ao editar. */
export function useItemKeys(length: number) {
  const [keys, setKeys] = useState<string[]>([]);
  if (keys.length !== length) {
    setKeys(
      Array.from({ length }, (_, index) => keys[index] ?? crypto.randomUUID()),
    );
  }
  return [keys, setKeys] as const;
}

export function SortableList({
  keys,
  onMove,
  children,
}: {
  keys: string[];
  onMove: (from: number, to: number) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onMove(keys.indexOf(String(active.id)), keys.indexOf(String(over.id)));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={keys} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export function SortableItem({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex gap-2 rounded-md border bg-background p-3",
        isDragging && "relative z-10 shadow-lg",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label="Arrastar para reordenar"
        className="-ml-1 flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center self-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <div className={cn("min-w-0 flex-1", className)}>{children}</div>
    </div>
  );
}
