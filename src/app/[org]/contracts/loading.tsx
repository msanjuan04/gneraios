import { Skeleton } from "@/components/ui/skeleton";

/** Listado de contratos cargando: cabecera, filtros por estado y filas. */
export default function ContractsLoading() {
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <Skeleton className="h-10 w-48" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-8 w-40 rounded-full" />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Skeleton className="h-8 w-72" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-20 rounded-full" />
        ))}
      </div>
      <div className="space-y-px overflow-hidden rounded-2xl border">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-none" />
        ))}
      </div>
    </div>
  );
}
