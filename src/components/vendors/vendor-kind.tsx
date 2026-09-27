"use client";

import { BriefcaseBusiness, Building2, Laptop, type LucideIcon, Server, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CostAllocation } from "@/domain/finance/allocation";
import type { VendorKind } from "@/domain/vendors";
import { cn } from "@/lib/utils";

/** Una empresa o un freelance (otros iconos que los destinos de un gasto, para no confundirlos). */
export const VENDOR_KIND_ICONS: Record<VendorKind, LucideIcon> = { company: BriefcaseBusiness, freelancer: Laptop };

/** Los destinos de un gasto, con los iconos de «¿A quién sirve?» del panel del gasto. */
export const ALLOCATION_ICONS: Record<CostAllocation, LucideIcon> = { company: Building2, client: UserRound, hosted_sites: Server };

const PILL: Record<VendorKind, string> = {
  company: "border-border text-muted-foreground",
  freelancer: "border-primary/30 bg-primary/10 text-primary",
};

/** El tipo de proveedor en píldora, con su nombre. */
export function VendorKindPill({ kind, className }: { kind: VendorKind; className?: string }) {
  const t = useTranslations("vendors.kinds");
  const Icon = VENDOR_KIND_ICONS[kind];
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-semibold", PILL[kind], className)}>
      <Icon aria-hidden className="size-3" />
      {t(kind)}
    </span>
  );
}

/** Solo el icono del tipo, con su nombre para lectores de pantalla (listas densas). */
export function VendorKindIcon({ kind, className }: { kind: VendorKind; className?: string }) {
  const t = useTranslations("vendors.kinds");
  const Icon = VENDOR_KIND_ICONS[kind];
  return (
    <span title={t(kind)} className={cn("inline-flex shrink-0", kind === "freelancer" ? "text-primary" : "text-muted-foreground", className)}>
      <Icon aria-hidden className="size-3.5" />
      <span className="sr-only">{t(kind)}</span>
    </span>
  );
}
