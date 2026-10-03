import { Skeleton } from "@/components/ui/skeleton";

/** Factura manual cargando: las opciones (emisores, series, IVA, clientes). */
export default function NewInvoiceLoading() {
  return (
    <div>
      <Skeleton className="mb-5 h-4 w-24" />
      <Skeleton className="mb-6 h-10 w-72 max-w-full" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    </div>
  );
}
