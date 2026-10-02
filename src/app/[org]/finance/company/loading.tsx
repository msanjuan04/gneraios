import { Skeleton } from "@/components/ui/skeleton";

/** Sociedad cargando: la ficha y la lista del expediente. */
export default function CompanyLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-40 rounded-2xl" />
      <Skeleton className="h-10 w-64" />
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-16 rounded-xl" />
      ))}
    </div>
  );
}
