import { Skeleton } from "@/components/ui/skeleton";

/** Listado de proyectos cargando: cabecera, carga del equipo, filtros y filas. */
export default function ProjectsLoading() {
  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Skeleton className="h-10 w-48" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-8 w-44 rounded-full" />
      </div>
      <Skeleton className="mb-5 h-12 rounded-2xl" />
      <div className="mb-3 flex flex-wrap gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-7 w-40" />
        <Skeleton className="ml-auto h-7 w-32 rounded-full" />
      </div>
      <div className="mb-3 flex flex-wrap gap-1">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-24 rounded-full" />
        ))}
      </div>
      <div className="space-y-px overflow-hidden rounded-2xl border">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-none" />
        ))}
      </div>
    </div>
  );
}
