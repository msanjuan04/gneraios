import { Skeleton } from "@/components/ui/skeleton";

/** Plantillas cargando: cabecera y tarjetas. */
export default function QuoteTemplatesLoading() {
  return (
    <div>
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <Skeleton className="h-10 w-72" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-8 w-36 rounded-full" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-44 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
