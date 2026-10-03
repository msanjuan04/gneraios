import { Skeleton } from "@/components/ui/skeleton";

/** Selección de facturas de una remesa cargando. */
export default function NewRemittanceLoading() {
  return (
    <div>
      <Skeleton className="mb-5 h-4 w-24" />
      <Skeleton className="h-10 w-72 max-w-full" />
      <Skeleton className="mt-3 mb-6 h-4 w-80 max-w-full" />
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-36 rounded-2xl" />
      </div>
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  );
}
