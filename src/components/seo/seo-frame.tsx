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

type SeoNavigation = { isPending: boolean; navigate: (href: string) => void };

const NavigationContext = createContext<SeoNavigation | null>(null);

/**
 * Cambiar de propiedad o de periodo es navegar (todo vive en la URL). Mientras llega la página
 * nueva se mantiene la anterior, atenuada: sin esqueletos ni saltos.
 */
export function SeoFrame({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const value = useMemo<SeoNavigation>(
    () => ({ isPending, navigate: (href) => startTransition(() => router.push(href, { scroll: false })) }),
    [isPending, router],
  );
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useSeoNavigation(): SeoNavigation {
  const context = useContext(NavigationContext);
  if (!context) throw new Error("useSeoNavigation necesita un <SeoFrame>.");
  return context;
}

/** Lo que cambia con el filtro: se atenúa mientras se carga. */
export function SeoContent({ children, className }: { children: ReactNode; className?: string }) {
  const { isPending } = useSeoNavigation();
  return (
    <div aria-busy={isPending || undefined} className={cn("transition-opacity duration-200", isPending && "opacity-60", className)}>
      {children}
    </div>
  );
}

/** Enlace que navega dentro de la transición (con modificadores, abre como siempre). */
export function SeoLink({ href, onClick, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const { navigate } = useSeoNavigation();
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  }
  return <Link href={href} onClick={handleClick} scroll={false} {...props} />;
}
