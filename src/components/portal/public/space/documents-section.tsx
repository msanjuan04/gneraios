import { ArrowRight, Download, FileSignature, FolderClosed, Landmark, Receipt, RefreshCw } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { SpaceData, SpaceInvoice } from "@/components/portal/types";
import type { ClientInvoiceStatus, PortalLocale } from "@/domain/portal";
import { portalCopy } from "@/server/portal/copy";
import { CopyButton } from "../copy-button";
import { Chip, civil, EmptyState, Eyebrow, money, pillClass, SectionCard } from "../ui";
import { SPACE_SECTION_ICONS } from "./icons";

const STATUS_TONES: Record<ClientInvoiceStatus, "success" | "primary" | "destructive" | "neutral"> = {
  paid: "success",
  pending: "primary",
  overdue: "destructive",
  voided: "neutral",
  rectifying: "neutral",
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <Eyebrow>{title}</Eyebrow>
      {children}
    </div>
  );
}

function PayRow({ label, value, copy }: { label: string; value: string; copy?: { label: string; copied: string } }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1 text-right font-semibold tabular">
        <span className="break-all">{value}</span>
        {copy && <CopyButton value={value.replace(/\s/g, "")} label={copy.label} copiedLabel={copy.copied} />}
      </dd>
    </div>
  );
}

/** Una factura pendiente con cómo pagarla: transferencia (IBAN, importe y concepto) o domiciliación. */
function PaymentCard({ invoice, token, locale }: { invoice: SpaceInvoice; token: string; locale: PortalLocale }) {
  const t = portalCopy(locale);
  const payment = invoice.payment;
  if (!payment) return null;
  const due = payment.dueOn
    ? payment.overdue
      ? t("space.sections.documents.pay.overdue", { date: civil(payment.dueOn, locale) })
      : t("space.sections.documents.pay.dueOn", { date: civil(payment.dueOn, locale) })
    : null;
  return (
    <article className="overflow-hidden rounded-2xl border bg-background/60">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
        <div>
          <p className="text-sm font-semibold text-muted-foreground">{invoice.number}</p>
          <p className="mt-1 text-3xl font-extrabold heading-tight tabular">{money(payment.amountCents, locale)}</p>
          {due && <p className={payment.overdue ? "mt-1 text-sm font-semibold text-destructive" : "mt-1 text-sm text-muted-foreground"}>{due}</p>}
        </div>
        <a href={`/api/public/c/${token}/invoices/${invoice.id}`} className={pillClass("secondary")} aria-label={t("space.sections.documents.downloadInvoice", { number: invoice.number })}>
          <Download aria-hidden />
          PDF
        </a>
      </div>
      <div className="border-t bg-muted/40 px-4 py-3 sm:px-5">
        {payment.kind === "sepa_debit" ? (
          <p className="flex items-start gap-2.5 py-1 text-sm">
            <RefreshCw className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            {t("space.sections.documents.pay.sepa")}
          </p>
        ) : (
          <>
            <p className="flex items-center gap-2 pt-1 text-sm font-bold">
              <Landmark className="size-4 text-primary" aria-hidden />
              {t("space.sections.documents.pay.transfer")}
            </p>
            {payment.iban ? (
              <dl className="divide-y divide-border">
                <PayRow label={t("space.sections.documents.pay.holder")} value={payment.holder} />
                <PayRow
                  label={t("space.sections.documents.pay.iban")}
                  value={payment.iban}
                  copy={{ label: t("space.sections.documents.pay.copy", { what: t("space.sections.documents.pay.iban") }), copied: t("space.sections.documents.pay.copied") }}
                />
                <PayRow label={t("space.sections.documents.pay.amount")} value={money(payment.amountCents, locale)} />
                <PayRow
                  label={t("space.sections.documents.pay.reference")}
                  value={payment.reference}
                  copy={{ label: t("space.sections.documents.pay.copy", { what: t("space.sections.documents.pay.reference") }), copied: t("space.sections.documents.pay.copied") }}
                />
              </dl>
            ) : (
              <p className="py-2 text-sm text-muted-foreground">{t("space.sections.documents.pay.noIban")}</p>
            )}
          </>
        )}
      </div>
    </article>
  );
}

/** «Documentos»: lo pendiente de pago primero, y después facturas, presupuestos y contratos. */
export function DocumentsSection({ data, token }: { data: SpaceData; token: string }) {
  const t = portalCopy(data.locale);
  const docs = data.documents ?? { invoices: [], quotes: [], contracts: [] };
  const pending = docs.invoices.filter((i) => i.payment);
  const empty = docs.invoices.length === 0 && docs.quotes.length === 0 && docs.contracts.length === 0;
  return (
    <SectionCard id="documents" icon={SPACE_SECTION_ICONS.documents} title={t("space.sections.documents.title")} subtitle={t("space.sections.documents.subtitle")}>
      {empty ? (
        <EmptyState icon={FolderClosed}>{t("space.sections.documents.empty")}</EmptyState>
      ) : (
        <div className="space-y-8">
          {pending.length > 0 && (
            <Group title={t("space.sections.documents.toPay")}>
              <div className="grid gap-3 lg:grid-cols-2">
                {pending.map((invoice) => (
                  <PaymentCard key={invoice.id} invoice={invoice} token={token} locale={data.locale} />
                ))}
              </div>
            </Group>
          )}

          {docs.quotes.length > 0 && (
            <Group title={t("space.sections.documents.quotes")}>
              <ul className="divide-y divide-border rounded-2xl border bg-background/50">
                {docs.quotes.map((quote) => (
                  <li key={quote.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <FileSignature className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      <div className="min-w-0">
                        <p className="font-semibold leading-snug">
                          {quote.title} <span className="font-normal text-muted-foreground">· {quote.number}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {quote.state === "open"
                            ? t("space.sections.documents.quoteOpen", { date: quote.validUntil ? civil(quote.validUntil, data.locale) : "" })
                            : t("space.sections.documents.quoteAccepted", { date: quote.acceptedOn ? civil(quote.acceptedOn, data.locale) : "" })}
                        </p>
                      </div>
                    </div>
                    {quote.state === "open" ? (
                      <Link href={`/p/c/${token}/q/${quote.id}`} className={pillClass("primary")}>
                        {t("space.sections.documents.review")}
                        <ArrowRight aria-hidden />
                      </Link>
                    ) : (
                      <a
                        href={`/api/public/c/${token}/quotes/${quote.id}`}
                        className={pillClass("secondary")}
                        aria-label={t("space.sections.documents.downloadQuote", { number: quote.number })}
                      >
                        <Download aria-hidden />
                        PDF
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </Group>
          )}

          {docs.invoices.length > 0 && (
            <Group title={t("space.sections.documents.invoices")}>
              <ul className="divide-y divide-border rounded-2xl border bg-background/50">
                {docs.invoices.map((invoice) => (
                  <li key={invoice.id} className="flex items-center justify-between gap-3 p-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <Receipt className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0">
                        <p className="font-semibold tabular">{invoice.number}</p>
                        <p className="text-xs text-muted-foreground">
                          {invoice.issuedOn ? t("space.sections.documents.invoiceIssuedOn", { date: civil(invoice.issuedOn, data.locale, "medium") }) : null}
                          {invoice.issuerName && <> · {invoice.issuerName}</>}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                      <Chip tone={STATUS_TONES[invoice.status]} className="hidden sm:inline-flex">
                        {t(`space.sections.documents.invoiceStatus.${invoice.status}`)}
                      </Chip>
                      <p className="text-right font-semibold tabular">{money(invoice.totalCents, data.locale)}</p>
                      <a
                        href={`/api/public/c/${token}/invoices/${invoice.id}`}
                        className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label={t("space.sections.documents.downloadInvoice", { number: invoice.number })}
                      >
                        <Download className="size-4" aria-hidden />
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </Group>
          )}

          {docs.contracts.length > 0 && (
            <Group title={t("space.sections.documents.contracts")}>
              <ul className="divide-y divide-border rounded-2xl border bg-background/50">
                {docs.contracts.map((contract) => (
                  <li key={contract.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="font-semibold leading-snug">{contract.title}</p>
                      <p className="text-xs text-muted-foreground">{t("space.sections.documents.contractSigned", { date: civil(contract.signedOn, data.locale) })}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {contract.status !== "draft" && (
                        <Chip tone={contract.status === "active" ? "success" : contract.status === "paused" ? "warning" : "neutral"}>
                          {t(`space.sections.documents.contractStates.${contract.status}`)}
                        </Chip>
                      )}
                      {contract.quote && (
                        <a
                          href={`/api/public/c/${token}/quotes/${contract.quote.id}`}
                          className={pillClass("secondary")}
                          aria-label={t("space.sections.documents.downloadQuote", { number: contract.quote.number })}
                        >
                          <Download aria-hidden />
                          {t("space.sections.documents.signedCopy")}
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Group>
          )}
        </div>
      )}
    </SectionCard>
  );
}
