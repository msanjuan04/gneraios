import { Skeleton } from "@/components/ui/skeleton";

/** Proveedores cargando: el resumen, los filtros y las filas. */
export default function VendorsLoading() {
  return (
    <div>
      <Skeleton className="mb-4 h-12 rounded-2xl" />
      <div className="mb-3 flex flex-wrap gap-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="ml-auto h-8 w-40 rounded-full" />
      </div>
      <div className="space-y-px overflow-hidden rounded-2xl border">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="h-12 rounded-none" />
        ))}
      </div>
    </div>
  );
}
