import { Skeleton } from "@/components/ui/skeleton";

/** Factura cargando: cabecera, tarjetas de datos y líneas, totales a la derecha. */
export default function InvoiceLoading() {
  return (
    <div className="mx-auto max-w-7xl">
      <Skeleton className="mb-5 h-4 w-24" />
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Skeleton className="h-10 w-64 max-w-full" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-8 w-72 max-w-full rounded-full" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  );
}
