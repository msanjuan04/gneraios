import { Skeleton } from "@/components/ui/skeleton";

/** Banco cargando: cuentas, cifras, filtros y movimientos. */
export default function BankLoading() {
  return (
    <div>
      <div className="mb-5 flex items-center gap-2">
        <Skeleton className="h-10 w-80 rounded-full" />
        <Skeleton className="ml-auto h-8 w-36 rounded-full" />
      </div>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[5.25rem] rounded-2xl" />
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Skeleton className="h-8 w-72 rounded-full" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-7 w-44" />
      </div>
      <div className="space-y-px overflow-hidden rounded-2xl border">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-none" />
        ))}
      </div>
    </div>
  );
}
