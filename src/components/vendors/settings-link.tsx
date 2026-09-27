"use client";

import { ArrowRight, Truck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** En Ajustes → Gastos: los proveedores y freelancers se llevan en Finanzas → Proveedores. */
export function VendorsSettingsLink({ href, count, className }: { href: string; count: number; className?: string }) {
  const t = useTranslations("vendors.settingsLink");
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-3 rounded-2xl border bg-card px-5 py-4 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
    >
      <Truck aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{t("title")}</span>
        <span className="block text-sm text-muted-foreground">{t("body", { count })}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary">
        {t("action")}
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
