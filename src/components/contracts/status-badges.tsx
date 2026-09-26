"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BillableState, ContractStatus, InvoiceStatus, LineStatus } from "./types";

/** Estados derivados (nunca se guardan): los colores son los de la marca para vivo, en pausa y terminado. */
const CONTRACT_STYLES: Record<ContractStatus, string> = {
  draft: "bg-secondary text-secondary-foreground",
  scheduled: "bg-primary/15 text-primary",
  active: "bg-success/15 text-success",
  paused: "bg-warning/15 text-warning",
  ended: "border-border bg-transparent text-muted-foreground",
};

const LINE_STYLES: Record<LineStatus, string> = {
  scheduled: "bg-primary/15 text-primary",
  active: "bg-success/15 text-success",
  paused: "bg-warning/15 text-warning",
  ended: "border-border bg-transparent text-muted-foreground",
};

const BILLABLE_STYLES: Record<BillableState, string> = {
  pending: "bg-warning/15 text-warning",
  drafted: "bg-primary/15 text-primary",
  invoiced: "bg-success/15 text-success",
  waived: "border-border bg-transparent text-muted-foreground",
};

const INVOICE_STYLES: Record<InvoiceStatus, string> = {
  draft: "bg-secondary text-secondary-foreground",
  issuing: "bg-warning/15 text-warning",
  issued: "bg-primary/15 text-primary",
  overdue: "bg-destructive/15 text-destructive",
  paid: "bg-success/15 text-success",
  voided: "border-border bg-transparent text-muted-foreground line-through",
};

export function ContractStatusBadge({ status, className }: { status: ContractStatus; className?: string }) {
  const t = useTranslations("billing.contractStatus");
  return <Badge className={cn(CONTRACT_STYLES[status], className)}>{t(status)}</Badge>;
}

export function LineStatusBadge({ status, className }: { status: LineStatus; className?: string }) {
  const t = useTranslations("billing.lineStatus");
  return <Badge className={cn(LINE_STYLES[status], className)}>{t(status)}</Badge>;
}

export function BillableStateBadge({ state, className }: { state: BillableState; className?: string }) {
  const t = useTranslations("billing.billableState");
  return <Badge className={cn(BILLABLE_STYLES[state], className)}>{t(state)}</Badge>;
}

export function InvoiceStatusBadge({ status, className }: { status: InvoiceStatus; className?: string }) {
  const t = useTranslations("billing.invoiceStatus");
  return <Badge className={cn(INVOICE_STYLES[status], className)}>{t(status)}</Badge>;
}
