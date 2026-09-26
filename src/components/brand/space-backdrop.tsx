import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Fondo de la home de gnerai.com: cielo estrellado con un halo azul arriba.
 * Solo para pantallas de entrada (login, onboarding); en pantallas de datos distrae.
 */
export function SpaceBackdrop({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative isolate min-h-svh overflow-hidden bg-background", className)}>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 hidden starfield opacity-60 dark:block" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(60%_55%_at_50%_0%,rgb(46_128_255/0.18),transparent_70%)]"
      />
      {children}
    </div>
  );
}
