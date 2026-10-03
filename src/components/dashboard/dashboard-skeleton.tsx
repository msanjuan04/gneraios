import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function CardSkeleton({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <div className={cn("rounded-xl bg-card p-4 ring-1 ring-foreground/10", className)}>{children}</div>;
}

function Lines({ rows }: { rows: number }) {
  return (
    <div className="mt-5 space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Esqueleto del dashboard: la misma rejilla, para que nada salte al llegar los datos. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-8" aria-busy>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Skeleton className="h-11 w-80 max-w-full md:h-12" />
          <Skeleton className="mt-3 h-5 w-64" />
        </div>
        <Skeleton className="h-7 w-44 rounded-full" />
      </div>

      <div className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-12">
        <CardSkeleton className="md:col-span-2 xl:col-span-6">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-5 h-14 w-64 max-w-full" />
          <Skeleton className="mt-3 h-4 w-48" />
          <Skeleton className="mt-6 h-14 w-full" />
        </CardSkeleton>
        {[0, 1].map((i) => (
          <CardSkeleton key={i} className="xl:col-span-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-5 h-9 w-36" />
            <Skeleton className="mt-3 h-4 w-28" />
            <Skeleton className="mt-10 h-3 w-40" />
          </CardSkeleton>
        ))}
        <CardSkeleton className="md:col-span-2 xl:col-span-6">
          <Skeleton className="h-3 w-40" />
          <div className="mt-5 grid gap-6 sm:grid-cols-5">
            <div className="sm:col-span-2">
              <Skeleton className="h-9 w-36" />
              <Skeleton className="mt-4 h-2 w-full rounded-full" />
            </div>
            <div className="space-y-2.5 sm:col-span-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        </CardSkeleton>
        {[0, 1].map((i) => (
          <CardSkeleton key={i} className="xl:col-span-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-5 h-9 w-36" />
            <Skeleton className="mt-4 h-1.5 w-full rounded-full" />
            <Skeleton className="mt-8 h-3 w-40" />
          </CardSkeleton>
        ))}
      </div>

      <div className="space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="mt-2 h-4 w-72" />
          </div>
          <Skeleton className="h-7 w-36 rounded-full" />
        </div>
        <div className="grid gap-4 xl:grid-cols-12">
          <CardSkeleton className="xl:col-span-8">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="mt-3 h-3 w-80 max-w-full" />
            <Skeleton className="mt-6 h-[300px] w-full" />
          </CardSkeleton>
          <CardSkeleton className="xl:col-span-4">
            <Skeleton className="h-4 w-40" />
            <div className="mt-6 space-y-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          </CardSkeleton>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <CardSkeleton key={i} className={i === 0 ? "lg:col-span-2 xl:col-span-1" : undefined}>
            <Skeleton className="h-4 w-40" />
            <Lines rows={4} />
          </CardSkeleton>
        ))}
      </div>
    </div>
  );
}
