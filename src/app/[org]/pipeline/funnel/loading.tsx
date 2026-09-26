import { Skeleton } from "@/components/ui/skeleton";

/** Esqueleto del embudo al llegar desde otra pestaña (cambiar de periodo no lo muestra). */
export default function Loading() {
  return (
    <div className="w-full max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Skeleton className="h-10 w-full max-w-[26rem] rounded-full" />
        <Skeleton className="h-8 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <Skeleton className="h-80 rounded-xl xl:col-span-3" />
        <Skeleton className="h-80 rounded-xl xl:col-span-2" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-64 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
