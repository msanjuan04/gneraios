import { Skeleton } from "@/components/ui/skeleton";

/** Bandeja «Por enviar» cargando. */
export default function OutboxLoading() {
  return (
    <div>
      <Skeleton className="h-10 w-48" />
      <Skeleton className="mt-3 mb-8 h-4 w-96 max-w-full" />
      <Skeleton className="mb-6 h-9 w-56 rounded-full" />
      <Skeleton className="mb-4 h-8 w-48 rounded-full" />
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
