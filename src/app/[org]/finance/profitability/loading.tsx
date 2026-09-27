import { Skeleton } from "@/components/ui/skeleton";

/** Rentabilidad cargando: el periodo, las siete cifras, la gráfica y la tabla. */
export default function ProfitabilityLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-full max-w-xl rounded-full" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-[5.5rem] rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  );
}
