import { Skeleton } from "@/components/ui/skeleton";

const ROWS_PER_GROUP = [2, 3, 4];

/** "Mis tareas" cargando: cabecera, alta rápida y grupos de filas. */
export default function MyTasksLoading() {
  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-14 rounded-2xl" />
      <div className="mt-6 space-y-6">
        {ROWS_PER_GROUP.map((rows, group) => (
          <div key={group}>
            <Skeleton className="mb-2 h-5 w-32" />
            <div className="space-y-px overflow-hidden rounded-2xl border">
              {Array.from({ length: rows }, (_, i) => (
                <Skeleton key={i} className="h-14 rounded-none" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
