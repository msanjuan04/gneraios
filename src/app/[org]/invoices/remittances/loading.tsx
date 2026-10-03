import { Skeleton } from "@/components/ui/skeleton";

/** Remesas cargando: cabecera, pestañas, alta, listado y datos de acreedor. */
export default function RemittancesLoading() {
  return (
    <div>
      <Skeleton className="h-10 w-56" />
      <Skeleton className="mt-3 mb-8 h-4 w-96 max-w-full" />
      <Skeleton className="mb-6 h-9 w-72 rounded-full" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    </div>
  );
}
