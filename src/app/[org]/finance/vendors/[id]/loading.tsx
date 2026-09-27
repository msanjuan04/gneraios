import { Skeleton } from "@/components/ui/skeleton";

/** Ficha de un proveedor cargando: cabecera, cifras, el reparto y sus gastos. */
export default function VendorLoading() {
  return (
    <div>
      <Skeleton className="mb-5 h-4 w-24" />
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-36 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-72 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-2xl lg:col-span-3" />
      </div>
    </div>
  );
}
