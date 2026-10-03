import { Skeleton } from "@/components/ui/skeleton";

const CARDS_PER_COLUMN = [3, 2, 1, 2];

/** Ficha de proyecto cargando: cabecera, cifras, pestañas y el tablero de tareas. */
export default function ProjectLoading() {
  return (
    <div>
      <Skeleton className="mb-5 h-4 w-24" />
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="mt-3 h-10 w-80 max-w-full" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-7 w-36 rounded-lg" />
          <Skeleton className="h-7 w-40 rounded-full" />
          <Skeleton className="h-7 w-24 rounded-full" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="mt-6 h-8 w-72 rounded-lg" />
      <div className="mt-4 flex gap-3 overflow-hidden">
        {CARDS_PER_COLUMN.map((cards, column) => (
          <div key={column} className="w-72 shrink-0 space-y-3 rounded-2xl border bg-card/40 p-3 md:flex-1">
            <Skeleton className="h-4 w-28" />
            {Array.from({ length: cards }, (_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
