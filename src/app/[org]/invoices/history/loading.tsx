import { Skeleton } from "@/components/ui/skeleton";

/** Histórico de facturación cargando. */
export default function InvoiceHistoryLoading() {
  return (
    <div>
      <Skeleton className="h-10 w-48" />
      <Skeleton className="mt-3 mb-8 h-4 w-96 max-w-full" />
      <Skeleton className="mb-6 h-9 w-72 rounded-full" />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-2xl" />
    </div>
  );
}
