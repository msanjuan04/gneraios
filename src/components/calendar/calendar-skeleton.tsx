import { Skeleton } from "@/components/ui/skeleton";

const CHIPS = [2, 0, 1, 3, 0, 1, 0, 1, 2, 0, 0, 3, 1, 0, 2, 1, 0, 0, 2, 1, 1, 0, 3, 0, 1, 2, 0, 0, 1, 2, 0, 1, 0, 2, 1];

/** El calendario cargando: la cabecera, los filtros y la cuadrícula del mes (en el móvil, la agenda). */
export function CalendarSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-8 w-40 rounded-full" />
        <Skeleton className="h-8 w-56 rounded-full" />
        <Skeleton className="ml-auto h-8 w-32 rounded-full" />
      </div>
      <div className="flex gap-1.5 overflow-hidden">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="h-6 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="hidden overflow-hidden rounded-2xl border sm:block">
        <div className="grid grid-cols-7 border-b">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="px-2 py-2">
              <Skeleton className="h-3 w-8" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {CHIPS.map((chips, i) => (
            <div key={i} className="min-h-32 space-y-1 border-r border-b p-1.5 [&:nth-child(7n)]:border-r-0">
              <Skeleton className="size-6 rounded-full" />
              {Array.from({ length: chips }, (_, j) => (
                <Skeleton key={j} className="h-4 w-full" />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-5 sm:hidden">
        {[3, 2, 4].map((rows, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-40" />
            {Array.from({ length: rows }, (_, j) => (
              <Skeleton key={j} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
