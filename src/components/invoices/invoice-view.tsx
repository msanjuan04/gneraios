"use client";

import {
  ArrowLeft,
  Ban,
  Building2,
  CircleAlert,
  Clock,
  Download,
  FilePen,
  FileSignature,
  Loader,
  Mail,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useState, useTransition } from "react";
import { toast } from "sonner";
import { composeEmail, issueDrafts } from "@/app/[org]/invoices/actions";
import { InvoiceCollectionsPanel } from "@/components/collections/invoice-collections-panel";
import { ImportedBadge } from "@/components/invoice-import/imported-badge";
import type { InvoiceCollectionsData } from "@/components/collections/types";
import { DetailItem, ReadOnlyNotice, SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { daysBetween } from "@/domain/dates/civil-date";
import { formatIban } from "@/domain/tax-id";
import { localeNames } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { EmailSheet, EmailsCard, type EmailDraft } from "./email-sheet";
import { useInvoiceFormat, usePeriodLabel } from "./format";
import { InvoiceKindBadge, InvoiceStatusBadge } from "./invoice-status-badge";
import { InvoiceTotals } from "./invoice-totals";
import { PaymentsCard } from "./payments-card";
import { invoicePdfHref, PdfPreview } from "./pdf-preview";
import { RectifySheet } from "./rectify-sheet";
import { ReleaseItemsCard } from "./release-items-card";
import type { InvoiceViewData, PartySnapshot } from "./types";

type Props = {
  slug: string;
  basePath: string;
  today: string;
  timeZone: string;
  canEdit: boolean;
  invoice: InvoiceViewData;
  /** Cobro por transferencia y domiciliación SEPA (src/server/collections/queries.ts → getInvoiceCollections). */
  collections?: InvoiceCollectionsData;
};

/**
 * Factura emitida (o que se quedó emitiendo): lo congelado al emitir, sus totales, el PDF legal,
 * los cobros, los emails y las rectificativas. Nada de lo emitido se edita: se corrige rectificando.
 */
export function InvoiceView({ slug, basePath, today, timeZone, canEdit, invoice, collections }: Props) {
  const t = useTranslations("invoices.view");
  const tMethod = useTranslations("billing.paymentMethod");
  const tStatus = useTranslations("billing.invoiceStatus");
  const { money, date, dateLong } = useInvoiceFormat();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [rectifyOpen, setRectifyOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [working, setWorking] = useState<"email" | "complete" | null>(null);
  const [, startTransition] = useTransition();

  const issued = invoice.lifecycle === "issued";
  const issuing = invoice.lifecycle === "issuing";
  const ordinary = invoice.kind === "ordinary";
  const number = invoice.number ?? "";
  const openRectification = invoice.rectifications.find((r) => r.lifecycle !== "issued") ?? null;
  const issuedRectifications = invoice.rectifications.filter((r) => r.lifecycle === "issued");
  const overdueDays = invoice.status === "overdue" && invoice.dueOn ? daysBetween(invoice.dueOn, today) : 0;
  const canCollect = canEdit && issued && ordinary && invoice.status !== "voided";

  const openEmail = () => {
    setWorking("email");
    startTransition(async () => {
      const result = await composeEmail(slug, invoice.id);
      setWorking(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setEmailDraft({ to: result.to, subject: result.subject, body: result.body, language: result.language });
    });
  };

  const completeIssue = () => {
    setWorking("complete");
    startTransition(async () => {
      const result = await issueDrafts(slug, [invoice.id]);
      setWorking(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const outcome = result.results[0];
      if (!outcome || !outcome.ok) {
        toast.error(outcome && !outcome.ok ? outcome.error : t("completeFailed"));
        return;
      }
      toast.success(t("completedToast", { number: outcome.number }));
    });
  };

  const openPayments = () => {
    setPaymentOpen(true);
    document.getElementById("invoice-payments")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const lines = invoice.lines.map((l) => ({
    baseCents: l.baseCents,
    vatCents: l.vatCents,
    irpfCents: l.irpfCents,
    vatBps: l.vatBps,
    vatRegime: l.vatRegime,
    billingType: l.billingType,
  }));
  const legalNotes = [...new Set(invoice.lines.map((l) => l.legalNote?.trim()).filter((n): n is string => Boolean(n)))];

  return (
    <div>
      <Link
        href={`${basePath}/invoices`}
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("back")}
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="font-mono text-3xl font-extrabold tracking-tight md:text-4xl">{number || t("noNumber")}</h2>
            <InvoiceStatusBadge status={invoice.status} />
            <InvoiceKindBadge kind={invoice.kind} />
            {invoice.source === "import" && <ImportedBadge />}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            <Link href={`${basePath}/clients/${invoice.clientId}`} className="inline-flex items-center gap-1.5 font-medium text-foreground hover:text-primary">
              <Building2 className="size-3.5" />
              {invoice.clientName}
            </Link>
            <span>{invoice.issuerName}</span>
            {invoice.issuedOn && <span className="tabular">{t("issuedOnShort", { date: date(invoice.issuedOn) })}</span>}
            {invoice.dueOn && ordinary && (
              <span className={cn("inline-flex items-center gap-1.5 tabular", invoice.status === "overdue" && "text-destructive")}>
                <Clock className="size-3.5" />
                {t("dueOnShort", { date: date(invoice.dueOn) })}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost">
            <a href={invoicePdfHref(invoice.id, { download: true })}>
              <Download data-icon="inline-start" />
              {t("download")}
            </a>
          </Button>
          {canEdit && issued && (
            <>
              <Button variant="outline" onClick={openEmail} disabled={working !== null}>
                <Mail data-icon="inline-start" />
                {working === "email" ? t("preparingEmail") : t("sendEmail")}
              </Button>
              {canCollect && (
                <Button variant="outline" onClick={openPayments}>
                  <Plus data-icon="inline-start" />
                  {t("addPayment")}
                </Button>
              )}
              {ordinary &&
                (openRectification ? (
                  <Button asChild variant="outline">
                    <Link href={`${basePath}/invoices/${openRectification.id}`}>
                      <FilePen data-icon="inline-start" />
                      {t("openRectification")}
                    </Link>
                  </Button>
                ) : (
                  invoice.status !== "voided" && (
                    <Button variant="outline" onClick={() => setRectifyOpen(true)}>
                      <FileSignature data-icon="inline-start" />
                      {t("rectify")}
                    </Button>
                  )
                ))}
            </>
          )}
        </div>
      </header>

      <div className="mb-6 space-y-3 empty:hidden">
        {!canEdit && <ReadOnlyNotice>{t("readOnly")}</ReadOnlyNotice>}
        {issuing && (
          <Banner tone="warning" icon={<Loader className="text-warning" />} title={t("issuingTitle")}>
            <p>{number ? t("issuingBody", { number }) : t("issuingBodyNoNumber")}</p>
            {canEdit && (
              <Button size="sm" className="mt-3" onClick={completeIssue} disabled={working !== null}>
                {working === "complete" ? t("completing") : t("complete")}
              </Button>
            )}
          </Banner>
        )}
        {invoice.status === "overdue" && (
          <Banner tone="destructive" icon={<CircleAlert className="text-destructive" />} title={t("overdueTitle", { count: overdueDays })}>
            <p>{t("overdueBody", { amount: money(invoice.outstandingCents) })}</p>
            {invoice.pendingReminders > 0 &&
              t.rich("remindersPending", {
                count: invoice.pendingReminders,
                link: (chunks) => (
                  <Link href={`${basePath}/invoices/outbox`} className="font-semibold text-foreground underline-offset-4 hover:underline">
                    {chunks}
                  </Link>
                ),
              })}
          </Banner>
        )}
        {invoice.status === "voided" && (
          <Banner tone="muted" icon={<Ban className="text-muted-foreground" />} title={t("voidedTitle")}>
            <p>{t("voidedBody")}</p>
          </Banner>
        )}
        {invoice.rectifies && (
          <Banner tone="muted" icon={<FileSignature className="text-muted-foreground" />} title={t("rectifyingTitle")}>
            <p>
              {t.rich("rectifies", {
                number: invoice.rectifies.number ?? "",
                link: (chunks) => (
                  <Link href={`${basePath}/invoices/${invoice.rectifies!.id}`} className="font-mono font-semibold text-primary hover:underline">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
            {invoice.rectificationReason && <p className="mt-1">{t("reason", { reason: invoice.rectificationReason })}</p>}
          </Banner>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <SettingsCard title={t("partiesTitle")} description={t("snapshotHint")}>
            <div className="grid gap-6 sm:grid-cols-2">
              <Party label={t("issuer")} party={invoice.issuer} />
              <Party label={t("client")} party={invoice.client} />
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4 sm:grid-cols-4">
              <DetailItem label={t("issuedOn")}>{invoice.issuedOn ? <span className="tabular">{dateLong(invoice.issuedOn)}</span> : "—"}</DetailItem>
              <DetailItem label={t("operationOn")}>
                {invoice.operationOn ? <span className="tabular">{dateLong(invoice.operationOn)}</span> : <span className="text-muted-foreground">{t("sameAsIssue")}</span>}
              </DetailItem>
              <DetailItem label={t("dueOn")}>{invoice.dueOn ? <span className="tabular">{dateLong(invoice.dueOn)}</span> : "—"}</DetailItem>
              <DetailItem label={t("paymentMethod")}>{tMethod(invoice.paymentMethod)}</DetailItem>
              <DetailItem label={t("series")}>{invoice.seriesCode ?? "—"}</DetailItem>
              <DetailItem label={t("language")}>{localeNames[invoice.language]}</DetailItem>
              {invoice.lastPaidOn && (
                <DetailItem label={t("lastPaidOn")}>
                  <span className="tabular">{dateLong(invoice.lastPaidOn)}</span>
                </DetailItem>
              )}
            </dl>
          </SettingsCard>

          <LinesCard invoice={invoice} />

          {invoice.notes && (
            <SettingsCard title={t("notes")}>
              <p className="whitespace-pre-line">{invoice.notes}</p>
            </SettingsCard>
          )}

          {ordinary && issued && (
            <div id="invoice-payments">
              <PaymentsCard
                slug={slug}
                invoiceId={invoice.id}
                payments={invoice.payments}
                netTotalCents={invoice.netTotalCents}
                paidCents={invoice.paidCents}
                outstandingCents={invoice.outstandingCents}
                defaultMethod={invoice.paymentMethod}
                today={today}
                canEdit={canCollect}
                formOpen={paymentOpen && canCollect}
                onFormOpenChange={setPaymentOpen}
                remittancePayments={Object.fromEntries(
                  Object.entries(collections?.remittancePayments ?? {}).map(([paymentId, remittanceId]) => [
                    paymentId,
                    `${basePath}/invoices/remittances/${remittanceId}`,
                  ]),
                )}
                footer={
                  collections &&
                  invoice.status !== "voided" && (
                    <InvoiceCollectionsPanel
                      basePath={basePath}
                      today={today}
                      invoice={{
                        number,
                        clientId: invoice.clientId,
                        beneficiary: invoice.issuer.legalName,
                        iban: invoice.issuer.iban,
                        outstandingCents: invoice.outstandingCents,
                      }}
                      data={collections}
                      canEdit={canCollect}
                    />
                  )
                }
              />
            </div>
          )}

          {invoice.status === "voided" && invoice.linkedItemsCount > 0 && canEdit && (
            <ReleaseItemsCard slug={slug} invoiceId={invoice.id} count={invoice.linkedItemsCount} />
          )}

          {invoice.rectifications.length > 0 && (
            <SettingsCard title={t("rectificationsTitle")} bodyClassName="p-0">
              <ul className="divide-y">
                {invoice.rectifications.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`${basePath}/invoices/${r.id}`}
                      className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-muted/40"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-mono font-semibold">{r.number ?? tStatus("draft")}</p>
                        {r.reason && <p className="truncate text-xs text-muted-foreground">{r.reason}</p>}
                      </div>
                      <InvoiceStatusBadge status={r.status} />
                      <span className="w-28 shrink-0 text-right font-semibold tabular">{money(r.totalCents)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </SettingsCard>
          )}

          <EmailsCard basePath={basePath} emails={invoice.emails} timeZone={timeZone} />
        </div>

        <aside className="min-w-0 space-y-6 xl:sticky xl:top-20 xl:self-start">
          <SettingsCard title={t("totalsTitle")}>
            <InvoiceTotals lines={lines} irpfBps={invoice.irpfBps} legalNotes={legalNotes}>
              {ordinary && issued && (
                <dl className="space-y-1.5 border-t pt-3 text-sm">
                  {issuedRectifications.length > 0 && (
                    <>
                      <MoneyRow label={t("rectified")} value={money(invoice.rectifiedCents)} />
                      <MoneyRow label={t("netTotal")} value={money(invoice.netTotalCents)} />
                    </>
                  )}
                  <MoneyRow label={t("paid")} value={money(invoice.paidCents)} tone="success" />
                  <MoneyRow
                    label={t("outstanding")}
                    value={money(invoice.outstandingCents)}
                    tone={invoice.status === "overdue" ? "destructive" : undefined}
                    strong
                  />
                </dl>
              )}
            </InvoiceTotals>
          </SettingsCard>
        </aside>
      </div>

      <PdfPreview className="mt-6" invoiceId={invoice.id} title={t("pdfTitle", { number })} downloadable />

      {canEdit && issued && (
        <>
          <EmailSheet slug={slug} invoiceId={invoice.id} number={number} draft={emailDraft} onClose={() => setEmailDraft(null)} />
          {ordinary && (
            <RectifySheet
              slug={slug}
              basePath={basePath}
              invoiceId={invoice.id}
              number={number}
              alreadyRectified={issuedRectifications.length > 0}
              open={rectifyOpen}
              onOpenChange={setRectifyOpen}
            />
          )}
        </>
      )}
    </div>
  );
}

function MoneyRow({ label, value, tone, strong }: { label: ReactNode; value: ReactNode; tone?: "success" | "destructive"; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cn(strong ? "font-semibold" : "text-muted-foreground")}>{label}</dt>
      <dd
        className={cn(
          "tabular",
          strong ? "font-bold" : "font-semibold",
          tone === "success" && "text-success",
          tone === "destructive" && "text-destructive",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

const BANNER_TONES = {
  warning: "border-warning/30 bg-warning/10",
  destructive: "border-destructive/30 bg-destructive/10",
  muted: "bg-muted/40",
} as const;

function Banner({ tone, icon, title, children }: { tone: keyof typeof BANNER_TONES; icon: ReactNode; title: ReactNode; children: ReactNode }) {
  return (
    <div className={cn("flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm", BANNER_TONES[tone])}>
      <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span>
      <div className="min-w-0 text-muted-foreground">
        <p className="font-semibold text-foreground">{title}</p>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}

function Party({ label, party }: { label: string; party: PartySnapshot }) {
  const t = useTranslations("invoices.view");
  const place = [[party.postalCode, party.city].filter(Boolean).join(" "), party.province, party.countryCode !== "ES" ? party.countryCode : null]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 font-semibold">{party.legalName || "—"}</p>
      {party.tradeName && <p className="text-xs text-muted-foreground">{party.tradeName}</p>}
      <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
        {party.taxId && (
          <p>
            {t("taxId")} <span className="font-mono text-foreground">{party.taxId}</span>
          </p>
        )}
        {party.addressLine && <p>{party.addressLine}</p>}
        {place && <p>{place}</p>}
        {party.email && <p>{party.email}</p>}
        {party.iban && (
          <p>
            {t("iban")} <span className="font-mono">{formatIban(party.iban)}</span>
          </p>
        )}
        {party.registryInfo && <p className="whitespace-pre-line">{party.registryInfo}</p>}
      </div>
    </div>
  );
}

function LinesCard({ invoice }: { invoice: InvoiceViewData }) {
  const t = useTranslations("invoices.lines");
  const tView = useTranslations("invoices.view");
  const tType = useTranslations("billing.billingType");
  const tRegime = useTranslations("billing.vatRegime");
  const { money, percent } = useInvoiceFormat();
  const period = usePeriodLabel();
  return (
    <SettingsCard title={tView("linesTitle")} description={tView("linesCount", { count: invoice.lines.length })} bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              <th className="py-2 pr-2 pl-5 font-semibold">{t("description")}</th>
              <th className="px-2 py-2 text-right font-semibold">{t("quantity")}</th>
              <th className="px-2 py-2 text-right font-semibold">{t("unitPrice")}</th>
              <th className="hidden px-2 py-2 text-right font-semibold sm:table-cell">{t("discount")}</th>
              <th className="hidden px-2 py-2 text-right font-semibold md:table-cell">{t("vat")}</th>
              <th className="py-2 pr-5 pl-2 text-right font-semibold">{t("base")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {invoice.lines.map((line) => {
              const linePeriod = period(line.periodStart, line.periodEnd);
              return (
                <tr key={line.id} className="align-top">
                  <td className="py-2.5 pr-2 pl-5">
                    <p className="font-medium">{line.description}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {tType(line.billingType)}
                      {linePeriod && <span className="tabular"> · {linePeriod}</span>}
                    </p>
                  </td>
                  <td className="px-2 py-2.5 text-right tabular">{String(line.quantity).replace(".", ",")}</td>
                  <td className="px-2 py-2.5 text-right tabular">{money(line.unitPriceCents)}</td>
                  <td className="hidden px-2 py-2.5 text-right text-muted-foreground tabular sm:table-cell">
                    {line.discountBps ? percent(line.discountBps) : "—"}
                  </td>
                  <td className="hidden px-2 py-2.5 text-right text-muted-foreground tabular md:table-cell">
                    {line.vatRegime === "general" ? percent(line.vatBps) : tRegime(line.vatRegime)}
                  </td>
                  <td className="py-2.5 pr-5 pl-2 text-right font-semibold tabular">{money(line.baseCents)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SettingsCard>
  );
}
