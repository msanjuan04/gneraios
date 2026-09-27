import { Skeleton } from "@/components/ui/skeleton";

/** Mientras se lee el fichero y se simula con el estado de la org. */
export default function ImportJobLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-2 h-5 w-64" />
        <Skeleton className="mt-2 h-3 w-80 max-w-full" />
      </div>
      <Skeleton className="h-8 w-96 max-w-full rounded-full" />
      <Skeleton className="h-14 rounded-2xl" />
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}
