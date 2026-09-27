import { Skeleton } from "@/components/ui/skeleton";

/** Resumen de Finanzas cargando: cifras, histórico, previsión y tarjetas. */
export default function FinanceLoading() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-xl" />
      <Skeleton className="h-80 rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-72 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
