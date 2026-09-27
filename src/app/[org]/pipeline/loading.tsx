import { Skeleton } from "@/components/ui/skeleton";

const CARDS_PER_COLUMN = [3, 2, 3, 1, 2];

/** Tablero cargando: columnas con tarjetas, para no enseñar el esqueleto del dashboard. */
export default function PipelineLoading() {
  return (
    <div className="flex gap-4 overflow-hidden">
      {CARDS_PER_COLUMN.map((cards, column) => (
        <div key={column} className="w-72 shrink-0 space-y-3 rounded-2xl border bg-card/40 p-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-16" />
          </div>
          {Array.from({ length: cards }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ))}
    </div>
  );
}
