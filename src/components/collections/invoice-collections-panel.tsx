"use client";

import { AlertTriangle, ArrowRight, Landmark, Repeat } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useInvoiceFormat } from "@/components/invoices/format";
import { Button } from "@/components/ui/button";
import { suggestCollectionDate } from "@/domain/collections";
import { formatIban } from "@/domain/tax-id";
import { cn } from "@/lib/utils";
import { CopyButton, ItemStateBadge, RemittanceStatusBadge, SequenceBadge } from "./shared";
import type { InvoiceCollectionsData, InvoiceRemittanceEntry } from "./types";

type Props = {
  basePath: string;
  today: string;
  invoice: {
    number: string;
    clientId: string;
    /** Emisor tal y como salió en la factura (issuer_snapshot): beneficiario y cuenta. */
    beneficiary: string;
    iban: string | null;
    outstandingCents: number;
  };
  data: InvoiceCollectionsData;
  /** Socio u owner: puede preparar una remesa desde aquí. */
  canEdit: boolean;
};

/**
 * Cómo cobrar una factura emitida, al pie de sus cobros: los datos para pagarla por transferencia
 * (el IBAN del emisor que lleva la factura y su número como concepto) y, si se cobra por
 * domiciliación, su mandato y en qué remesa va (o fue, cobrada o devuelta).
 */
export function InvoiceCollectionsPanel({ basePath, today, invoice, data, canEdit }: Props) {
  const showTransfer = invoice.outstandingCents > 0;
  if (!showTransfer && !data.sepa) return null;
  return (
    <div className={cn("grid gap-4 border-t px-5 py-4", showTransfer && data.sepa && "lg:grid-cols-2")}>
      {showTransfer && <TransferDetails invoice={invoice} />}
      {data.sepa && <SepaDetails basePath={basePath} today={today} invoice={invoice} data={data} canEdit={canEdit} />}
    </div>
  );
}

function TransferDetails({ invoice }: { invoice: Props["invoice"] }) {
  const t = useTranslations("collections.invoice.transfer");
  const { money } = useInvoiceFormat();
  const amount = money(invoice.outstandingCents);
  const iban = invoice.iban ? formatIban(invoice.iban) : null;
  const all = [
    t("copyBeneficiary", { name: invoice.beneficiary }),
    iban ? t("copyIban", { iban }) : null,
    t("copyReference", { reference: invoice.number }),
    t("copyAmount", { amount }),
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          <Landmark className="size-3.5" />
          {t("title")}
        </h4>
        <CopyButton value={all} label={t("copyAll")} />
      </div>
      <dl className="space-y-1.5 text-sm">
        <Row label={t("beneficiary")} value={invoice.beneficiary} />
        {iban ? (
          <Row label={t("iban")} value={<span className="font-mono">{iban}</span>} copy={invoice.iban!} copyLabel={t("copyIbanLabel")} />
        ) : (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            {t("noIban")}
          </p>
        )}
        <Row
          label={t("reference")}
          value={<span className="font-mono">{invoice.number}</span>}
          copy={invoice.number}
          copyLabel={t("copyReferenceLabel")}
        />
        <Row label={t("amount")} value={<span className="font-semibold tabular">{amount}</span>} />
      </dl>
    </section>
  );
}

function Row({ label, value, copy, copyLabel }: { label: string; value: ReactNode; copy?: string; copyLabel?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1 text-right">
        <span className="truncate">{value}</span>
        {copy && copyLabel && <CopyButton value={copy} label={copyLabel} />}
      </dd>
    </div>
  );
}

function SepaDetails({ basePath, today, invoice, data, canEdit }: Omit<Props, "invoice"> & { invoice: Props["invoice"] }) {
  const t = useTranslations("collections.invoice.sepa");
  const current = data.entries[0] ?? null;
  const open = current !== null && current.state === "pending";
  const collectionOn = suggestCollectionDate(today);

  return (
    <section className="min-w-0">
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        <Repeat className="size-3.5" />
        {t("title")}
      </h4>
      <div className="space-y-2 text-sm">
        {current && <EntryLine basePath={basePath} entry={current} />}
        {data.entries.length > 1 && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {data.entries.slice(1).map((e) => (
              <li key={e.itemId}>
                <EntryLine basePath={basePath} entry={e} compact />
              </li>
            ))}
          </ul>
        )}

        {data.mandate ? (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {t("mandate", { reference: data.mandate.reference, iban: formatIban(data.mandate.iban) })}
            <SequenceBadge sequence={data.mandate.nextSequence} />
          </p>
        ) : (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            <span>
              {t.rich("noMandate", {
                link: (chunks) => (
                  <Link href={`${basePath}/clients/${invoice.clientId}`} className="font-semibold underline-offset-4 hover:underline">
                    {chunks}
                  </Link>
                ),
              })}
            </span>
          </p>
        )}

        {!open && invoice.outstandingCents > 0 && data.mandate && (
          <>
            <p className="text-xs text-muted-foreground">{t("notInRemittance")}</p>
            {canEdit && (
              <Button asChild variant="outline" size="sm">
                <Link href={`${basePath}/invoices/remittances/new?issuer=${data.issuerId}&on=${collectionOn}`}>
                  {t("prepare")}
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function EntryLine({ basePath, entry, compact = false }: { basePath: string; entry: InvoiceRemittanceEntry; compact?: boolean }) {
  const t = useTranslations("collections.invoice.sepa");
  const { date, money } = useInvoiceFormat();
  const link = (chunks: ReactNode) => (
    <Link href={`${basePath}/invoices/remittances/${entry.remittanceId}`} className="font-semibold text-foreground underline-offset-4 hover:underline">
      {chunks}
    </Link>
  );
  const values = { date: date(entry.collectionOn), amount: money(entry.amountCents) };
  const text =
    entry.state === "returned"
      ? t.rich("entryReturned", {
          ...values,
          link,
          returnedOn: entry.returnedOn ? date(entry.returnedOn) : "—",
          reason: [entry.returnCode, entry.returnReason].filter(Boolean).join(" · ") || t("noReason"),
        })
      : entry.state === "collected"
        ? t.rich("entryCollected", { ...values, link })
        : t.rich("entryPending", { ...values, link });
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", compact ? "text-xs" : "text-sm")}>
      <span>{text}</span>
      {!compact && (entry.state === "pending" ? <RemittanceStatusBadge status={entry.status} /> : <ItemStateBadge state={entry.state} />)}
    </div>
  );
}
