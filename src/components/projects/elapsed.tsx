"use client";

import { useNow } from "next-intl";
import { formatElapsed } from "@/domain/projects";

/**
 * Segundos desde un instante, actualizados cada segundo. `useNow` parte del mismo "ahora" que el
 * servidor (src/i18n/request.ts), así que la hidratación no se desajusta.
 */
export function useElapsedSeconds(startedAt: string | null): number {
  const now = useNow({ updateInterval: startedAt ? 1000 : undefined });
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((now.getTime() - new Date(startedAt).getTime()) / 1000));
}

/** Cronómetro en marcha: "1:02:05". */
export function Elapsed({ startedAt, className }: { startedAt: string; className?: string }) {
  const seconds = useElapsedSeconds(startedAt);
  return <span className={className}>{formatElapsed(seconds)}</span>;
}
