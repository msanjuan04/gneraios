import { Skeleton } from "@/components/ui/skeleton";

/** Esqueleto de SEO al llegar desde otra pestaña (cambiar de propiedad o periodo no lo muestra). */
export default function Loading() {
  return (
    <div className="w-full space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-5 w-96 max-w-full" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-56 rounded-full" />
        <Skeleton className="h-9 w-64 rounded-full" />
        <Skeleton className="h-9 w-72 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-36 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-[26rem] rounded-xl" />
      <div className="grid gap-4 xl:grid-cols-5">
        <Skeleton className="h-96 rounded-xl xl:col-span-3" />
        <Skeleton className="h-96 rounded-xl xl:col-span-2" />
      </div>
    </div>
  );
}
