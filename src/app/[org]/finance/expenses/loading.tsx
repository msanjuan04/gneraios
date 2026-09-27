import { Skeleton } from "@/components/ui/skeleton";

/** Gastos cargando: cifras, filtros y filas. */
export default function ExpensesLoading() {
  return (
    <div>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[5.25rem] rounded-2xl" />
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-7 w-36" />
      </div>
      <div className="space-y-px overflow-hidden rounded-2xl border">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="h-12 rounded-none" />
        ))}
      </div>
    </div>
  );
}
