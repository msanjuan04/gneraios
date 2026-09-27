"use client";

import { Repeat, Server, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CostAllocation, ExpenseStatus, RebillState } from "./types";

const STATUS_STYLES: Record<ExpenseStatus, string> = {
  pending: "bg-secondary text-secondary-foreground",
  overdue: "bg-destructive/15 text-destructive",
  paid: "bg-success/15 text-success",
};

/** Estado derivado de un gasto (pendiente, vencido, pagado). Nunca se guarda. */
export function ExpenseStatusBadge({ status, className }: { status: ExpenseStatus; className?: string }) {
  const t = useTranslations("finance.status");
  return <Badge className={cn(STATUS_STYLES[status], className)}>{t(status)}</Badge>;
}

/** Marca discreta de lo que genera una suscripción. */
export function SubscriptionMark({ className }: { className?: string }) {
  const t = useTranslations("finance.expenses");
  return (
    <span title={t("fromSubscription")} className={cn("inline-flex text-muted-foreground", className)}>
      <Repeat aria-hidden className="size-3.5" />
      <span className="sr-only">{t("fromSubscription")}</span>
    </span>
  );
}

const REBILL_STYLES: Record<RebillState, string> = {
  pending: "text-warning",
  drafted: "text-primary",
  invoiced: "text-success",
};

/**
 * A quién sirve un gasto (o una suscripción), como una píldora discreta: el cliente o «Webs
 * alojadas»; nada si es de la empresa. Con `rebillState`, en qué punto está su repercusión.
 */
export function AllocationBadge({
  allocation,
  clientName,
  rebillState = null,
  className,
}: {
  allocation: CostAllocation;
  clientName: string | null;
  rebillState?: RebillState | null;
  className?: string;
}) {
  const t = useTranslations("finance");
  if (allocation === "company") return null;
  const hosted = allocation === "hosted_sites";
  const label = hosted ? t("allocation.hosted_sites") : (clientName ?? t("allocation.unknownClient"));
  const Icon = hosted ? Server : UserRound;
  return (
    <span
      title={hosted ? t("allocation.hostedSitesTitle") : t("allocation.clientTitle", { client: label })}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border bg-background/40 px-1.5 py-px text-[10px] leading-4 font-semibold text-muted-foreground",
        className,
      )}
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
      {rebillState && <span className={cn("shrink-0", REBILL_STYLES[rebillState])}>· {t(`rebillState.${rebillState}`)}</span>}
    </span>
  );
}
