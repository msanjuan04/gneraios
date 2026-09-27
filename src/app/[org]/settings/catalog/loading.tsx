import { Skeleton } from "@/components/ui/skeleton";

/** Mientras carga el catálogo: la cabecera y un par de categorías con sus filas. */
export default function CatalogLoading() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Skeleton className="h-5 w-56" />
          <Skeleton className="mt-2 h-4 w-96 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-36 rounded-full" />
        </div>
      </div>
      {[4, 2, 3].map((rows, group) => (
        <div key={group} className="rounded-2xl border">
          <div className="border-b px-4 py-2.5">
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="divide-y">
            {Array.from({ length: rows }, (_, row) => (
              <div key={row} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-4 rounded" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-48 max-w-full" />
                  <Skeleton className="mt-1.5 h-3 w-80 max-w-full" />
                </div>
                <Skeleton className="hidden h-5 w-16 rounded-full sm:block" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
