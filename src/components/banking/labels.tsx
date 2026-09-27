"use client";

import { useTranslations } from "next-intl";
import { useFinanceFormat } from "@/components/finance/format";
import { Badge } from "@/components/ui/badge";
import type { Reason, Suggestion } from "@/domain/banking/matcher";
import { cn } from "@/lib/utils";
import type { Confidence, ReconciliationStatus } from "./types";

const STATUS_STYLES: Record<ReconciliationStatus, string> = {
  unmatched: "bg-warning/15 text-warning",
  partial: "bg-primary/15 text-primary",
  reconciled: "bg-success/15 text-success",
  ignored: "bg-secondary text-muted-foreground",
};

/** Estado derivado de un movimiento (sin conciliar, parcial, conciliado, ignorado). Nunca se guarda. */
export function StatusBadge({ status, className }: { status: ReconciliationStatus; className?: string }) {
  const t = useTranslations("banking.status");
  return <Badge className={cn(STATUS_STYLES[status], className)}>{t(status)}</Badge>;
}

const CONFIDENCE_STYLES: Record<Confidence, string> = {
  alta: "bg-success",
  media: "bg-warning",
  baja: "bg-muted-foreground/60",
};

/** Punto de color de la confianza, con su texto para lectores de pantalla. */
export function ConfidenceDot({ confidence, className }: { confidence: Confidence; className?: string }) {
  const t = useTranslations("banking.confidence");
  return (
    <span className={cn("inline-flex items-center", className)} title={t("label", { level: t(confidence) })}>
      <span aria-hidden className={cn("size-2 rounded-full", CONFIDENCE_STYLES[confidence])} />
      <span className="sr-only">{t("label", { level: t(confidence) })}</span>
    </span>
  );
}

/** Importe con signo: los abonos en verde (con +) y los cargos en rojo. */
export function Amount({ cents, className }: { cents: number; className?: string }) {
  const { money } = useFinanceFormat();
  return (
    <span className={cn("font-semibold tabular whitespace-nowrap", cents > 0 ? "text-success" : "text-destructive", className)}>
      {cents > 0 ? "+" : ""}
      {money(cents)}
    </span>
  );
}

/** Motivos de una propuesta en palabras llanas ("Importe exacto", "Número 2026-0051 en el concepto"). */
export function useReasonText() {
  const t = useTranslations("banking.reasons");
  const { money, date } = useFinanceFormat();
  return (reason: Reason): string => {
    const p = reason.params ?? {};
    const values: Record<string, string | number> = { ...p };
    if (typeof p.leftCents === "number") values.left = money(p.leftCents);
    if (typeof p.restCents === "number") values.rest = money(p.restCents);
    if (typeof p.date === "string") values.date = date(p.date);
    return t(reason.code, values);
  };
}

/** Qué propone una propuesta, en una línea ("Factura 2026-0051 · Restaurant Can Sorra"). */
export function useSuggestionLabel() {
  const t = useTranslations("banking");
  const { date } = useFinanceFormat();
  return (s: Suggestion): { kind: string; subject: string; detail: string | null } => {
    const subject = s.subject;
    const numbers = (subject.invoices ?? []).map((i) => i.number ?? "—").join(" + ");
    switch (s.kind) {
      case "invoice":
      case "invoices":
        return { kind: t(`kinds.${s.kind}`), subject: numbers, detail: subject.clientName ?? null };
      case "payment":
        return { kind: t("kinds.payment"), subject: numbers, detail: subject.clientName ?? null };
      case "remittance":
        return {
          kind: t("kinds.remittance"),
          subject: t("subject.remittance", { date: subject.collectionOn ? date(subject.collectionOn) : "—", count: subject.itemsCount ?? 0 }),
          detail: null,
        };
      case "expense":
        return { kind: t("kinds.expense"), subject: subject.vendorName ?? subject.description ?? "—", detail: subject.categoryName ?? null };
      case "new_expense": {
        const tax = s.draft?.tax;
        const name =
          subject.vendorName ??
          (tax ? t(tax.authority === "aeat" ? "subject.taxAeat" : "subject.taxTgss") : s.draft?.purpose === "fee" ? t("subject.fee") : t("subject.noVendor"));
        return { kind: t("kinds.new_expense"), subject: name, detail: subject.categoryName ?? t("subject.noCategory") };
      }
      case "ignore":
        return {
          kind: t("kinds.ignore"),
          subject:
            s.ignoreReason === "internal_transfer"
              ? subject.accountName
                ? t("subject.internalTransfer", { account: subject.accountName })
                : t("subject.internalTransferUnknown")
              : t("subject.partner", { name: subject.partyName ?? "" }),
          detail: null,
        };
    }
  };
}

/** Qué es un movimiento según su concepto común de la Norma 43 ("04" → Transferencias), si lo hay. */
export function useBankCodeLabel() {
  const t = useTranslations("banking.codes");
  return (code: string | null): string | null => {
    const common = code?.slice(0, 2);
    return common && t.has(common) ? t(common) : null;
  };
}
