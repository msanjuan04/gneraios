"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { InvoiceKind, InvoiceStatus } from "./types";

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  draft: "border-border bg-transparent text-foreground",
  issuing: "bg-warning/15 text-warning",
  issued: "bg-secondary text-secondary-foreground",
  overdue: "bg-destructive/15 text-destructive",
  paid: "bg-success/15 text-success",
  voided: "bg-muted text-muted-foreground line-through decoration-muted-foreground/50",
};

/** Estado derivado de una factura (borrador, emitiendo, emitida, vencida, cobrada, anulada). Nunca se guarda. */
export function InvoiceStatusBadge({ status, className }: { status: InvoiceStatus; className?: string }) {
  const t = useTranslations("billing.invoiceStatus");
  return <Badge className={cn(STATUS_STYLES[status], className)}>{t(status)}</Badge>;
}

/** Marca discreta de rectificativa, junto al número. */
export function InvoiceKindBadge({ kind, className }: { kind: InvoiceKind; className?: string }) {
  const t = useTranslations("billing.invoiceKind");
  if (kind !== "rectifying") return null;
  return (
    <Badge variant="outline" className={cn("text-muted-foreground", className)}>
      {t(kind)}
    </Badge>
  );
}
