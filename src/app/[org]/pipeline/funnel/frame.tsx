"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ComponentProps,
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
  useMemo,
  useTransition,
} from "react";
import { cn } from "@/lib/utils";

type FunnelNavigation = { isPending: boolean; navigate: (href: string) => void };

const NavigationContext = createContext<FunnelNavigation | null>(null);

/**
 * Cambiar el periodo es navegar (el filtro vive en la URL). Mientras llega la página nueva se
 * mantiene la anterior, atenuada: sin esqueletos ni saltos.
 */
export function FunnelFrame({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const value = useMemo<FunnelNavigation>(
    () => ({
      isPending,
      navigate: (href) => startTransition(() => router.push(href, { scroll: false })),
    }),
    [isPending, router],
  );
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useFunnelNavigation(): FunnelNavigation {
  const context = useContext(NavigationContext);
  if (!context) throw new Error("useFunnelNavigation necesita un <FunnelFrame>.");
  return context;
}

/** Lo que el filtro afecta: se atenúa mientras se carga el periodo nuevo. */
export function FunnelContent({ children, className }: { children: ReactNode; className?: string }) {
  const { isPending } = useFunnelNavigation();
  return (
    <div
      aria-busy={isPending || undefined}
      className={cn("transition-opacity duration-200", isPending && "opacity-60", className)}
    >
      {children}
    </div>
  );
}

/** Enlace que cambia el periodo dentro de la transición (con modificadores abre como siempre). */
export function FunnelLink({ href, onClick, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const { navigate } = useFunnelNavigation();
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(href);
  }
  return <Link href={href} onClick={handleClick} scroll={false} {...props} />;
}
