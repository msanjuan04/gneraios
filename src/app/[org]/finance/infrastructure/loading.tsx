import { Skeleton } from "@/components/ui/skeleton";

/** Infraestructura cargando: la barra de acciones, las cinco cifras, las dos gráficas, las renovaciones y las webs. */
export default function InfrastructureLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-full max-w-xl rounded-full" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[5.5rem] rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-96 rounded-2xl xl:col-span-2" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    </div>
  );
}
