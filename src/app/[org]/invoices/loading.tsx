import { Skeleton } from "@/components/ui/skeleton";

/** Listado de facturas cargando: cabecera, cifras, pestañas y filas. */
export default function InvoicesLoading() {
  return (
    <div>
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <Skeleton className="h-10 w-48" />
          <Skeleton className="mt-3 h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-8 w-36 rounded-full" />
      </div>
      <Skeleton className="mb-6 h-9 w-56 rounded-full" />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <div className="mb-3 flex gap-2">
        <Skeleton className="h-9 w-96 max-w-full rounded-full" />
        <Skeleton className="h-8 w-72" />
      </div>
      <div className="space-y-px overflow-hidden rounded-2xl border">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-12 rounded-none" />
        ))}
      </div>
    </div>
  );
}
