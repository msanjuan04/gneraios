"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragOverEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

/** Mueve `activeId` al sitio de `overId`: el orden nuevo, o null si no cambia nada. */
export function reorderIds(ids: readonly string[], activeId: string, overId: string): string[] | null {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return null;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
}

const HANDLE_CLASS = "-ml-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60";

/**
 * Lista que se ordena arrastrando (con el ratón, el dedo o el teclado: Espacio para coger, flechas
 * y Espacio para soltar), sobre @dnd-kit/core. Cada fila recibe su asa ya hecha para colocarla
 * donde quiera; mientras se arrastra, una copia sigue al puntero y una raya marca dónde caerá. Al
 * soltar, `onReorder` recibe los ids en el orden nuevo: quien la usa lo aplica (y lo guarda).
 */
export function SortableList<T extends { id: string }>({
  id,
  items,
  label,
  disabled = false,
  onReorder,
  renderItem,
  className,
}: {
  /** Único en la página (dnd-kit lo usa para sus descripciones accesibles). */
  id: string;
  items: readonly T[];
  /** Nombre de cada fila, para el asa y los anuncios del lector de pantalla. */
  label: (item: T) => string;
  /** Sin arrastre (quien solo lee): el asa no aparece. */
  disabled?: boolean;
  onReorder: (ids: string[]) => void;
  /** `handle`: el asa para arrastrar la fila (null sin arrastre). */
  renderItem: (item: T, handle: ReactNode) => ReactNode;
  className?: string;
}) {
  const t = useTranslations("catalog.dnd");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] } }),
  );
  const ids = items.map((item) => item.id);
  const nameOf = (value: string | number | undefined) => {
    const item = items.find((i) => i.id === value);
    return item ? label(item) : "";
  };
  const active = items.find((item) => item.id === activeId) ?? null;
  const direction = activeId && overId ? Math.sign(ids.indexOf(overId) - ids.indexOf(activeId)) : 0;

  const reset = () => {
    setActiveId(null);
    setOverId(null);
  };

  const onDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    reset();
    if (!over) return;
    const next = reorderIds(ids, String(dragged.id), String(over.id));
    if (next) onReorder(next);
  };

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active: dragged }) => setActiveId(String(dragged.id))}
      onDragOver={({ over }: DragOverEvent) => setOverId(over ? String(over.id) : null)}
      onDragEnd={onDragEnd}
      onDragCancel={reset}
      accessibility={{
        screenReaderInstructions: { draggable: t("instructions") },
        announcements: {
          onDragStart: ({ active: dragged }) => t("picked", { name: nameOf(dragged.id) }),
          onDragOver: ({ active: dragged, over }) => (over ? t("over", { name: nameOf(dragged.id), target: nameOf(over.id) }) : undefined),
          onDragEnd: ({ active: dragged }) => t("dropped", { name: nameOf(dragged.id) }),
          onDragCancel: ({ active: dragged }) => t("cancelled", { name: nameOf(dragged.id) }),
        },
      }}
    >
      <ul className={className}>
        {items.map((item) => (
          <SortableRow
            key={item.id}
            id={item.id}
            label={t("handle", { name: label(item) })}
            disabled={disabled}
            indicator={item.id === overId && item.id !== activeId ? (direction < 0 ? "before" : "after") : null}
            dragging={item.id === activeId}
            render={(handle) => renderItem(item, handle)}
          />
        ))}
      </ul>
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className="rounded-xl border bg-popover shadow-lg ring-1 ring-primary/30">
            {renderItem(
              active,
              <span className={HANDLE_CLASS} aria-hidden>
                <GripVertical className="size-4" />
              </span>,
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function SortableRow({
  id,
  label,
  disabled,
  indicator,
  dragging,
  render,
}: {
  id: string;
  label: string;
  disabled: boolean;
  indicator: "before" | "after" | null;
  dragging: boolean;
  render: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, setActivatorNodeRef } = useDraggable({ id, disabled });
  const { setNodeRef: setDropRef } = useDroppable({ id, disabled });
  const handle = disabled ? null : (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={label}
      className={cn(
        HANDLE_CLASS,
        "cursor-grab touch-none outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing",
      )}
    >
      <GripVertical className="size-4" />
    </button>
  );
  return (
    <li
      ref={(element) => {
        setDragRef(element);
        setDropRef(element);
      }}
      className={cn(
        "relative transition-opacity",
        dragging && "opacity-40",
        indicator === "before" && "before:absolute before:inset-x-3 before:-top-px before:h-0.5 before:rounded-full before:bg-primary",
        indicator === "after" && "after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary",
      )}
    >
      {render(handle)}
    </li>
  );
}
