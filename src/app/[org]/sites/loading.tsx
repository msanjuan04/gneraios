import { Skeleton } from "@/components/ui/skeleton";

/** Webs cargando: cabecera, resumen, filtros y filas. */
export default function SitesLoading() {
  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Skeleton className="h-10 w-40" />
          <Skeleton className="mt-3 h-4 w-[28rem] max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-32 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
      </div>
      <Skeleton className="mb-5 h-14 rounded-2xl" />
      <div className="mb-3 flex flex-wrap gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-28 rounded-full" />
        ))}
        <Skeleton className="ml-auto h-8 w-64" />
      </div>
      <div className="space-y-px overflow-hidden rounded-2xl border">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-12 rounded-none" />
        ))}
      </div>
    </div>
  );
}
