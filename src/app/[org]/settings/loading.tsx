import { Skeleton } from "@/components/ui/skeleton";

/** Al cambiar de pestaña, la cabecera y las pestañas se quedan; solo carga el contenido. */
export default function SettingsLoading() {
  return (
    <div>
      <Skeleton className="h-5 w-48" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <Skeleton className="mt-6 h-56 rounded-2xl" />
      <Skeleton className="mt-4 h-40 rounded-2xl" />
    </div>
  );
}
