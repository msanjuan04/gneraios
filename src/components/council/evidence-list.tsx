"use client";

import { ArrowUpRight, CircleDashed } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { EvidenceItem } from "@/council/types";
import { civil } from "./meta";

type Formatter = ReturnType<typeof useFormatter>;

/** "2026-08" → "ago 2026"; "2026-09-26" → "26 sept 2026"; "a/b" → "a – b". */
export function formatPeriod(period: string, format: Formatter): string {
  if (!period) return "";
  const [from, to] = period.split("/");
  const one = (p: string) => {
    if (/^\d{4}-\d{2}$/.test(p)) return format.dateTime(civil(`${p}-01`), { month: "short", year: "numeric" });
    if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return format.dateTime(civil(p), { day: "numeric", month: "short", year: "numeric" });
    return p;
  };
  return to ? `${one(from!)} – ${one(to)}` : one(from!);
}

/** "Ver cálculo": cada cifra con su periodo, la tool que la calculó y el enlace a la pantalla donde se ve. */
export function EvidenceList({ items, basePath, emptyLabel }: { items: readonly EvidenceItem[]; basePath: string; emptyLabel?: string }) {
  const t = useTranslations("council.evidence");
  const tTools = useTranslations("council.tools");
  const format = useFormatter();
  if (items.length === 0) return emptyLabel ? <p className="text-sm text-muted-foreground">{emptyLabel}</p> : null;
  return (
    <ul className="divide-y rounded-xl border bg-background/50 text-sm">
      {items.map((item) => {
        const missing = item.unit === "missing";
        const tool = tTools.has(item.tool) ? tTools(item.tool) : item.tool;
        return (
          <li key={`${item.ref}:${item.key}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
            <span className="min-w-0 flex-1 basis-60">
              <span className="block">{item.label}</span>
              <span className="block text-xs text-muted-foreground">
                {[formatPeriod(item.period, format), t("from", { tool })].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className={missing ? "flex items-center gap-1 text-xs font-semibold text-warning" : "font-semibold tabular"}>
              {missing && <CircleDashed aria-hidden className="size-3.5" />}
              {missing ? t("missing") : item.display}
            </span>
            {item.href && (
              <Link href={`${basePath}${item.href}`} className="text-muted-foreground hover:text-primary" aria-label={t("open", { label: item.label })}>
                <ArrowUpRight aria-hidden className="size-4" />
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
