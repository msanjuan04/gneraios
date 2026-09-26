"use client";

import { Plus, Receipt } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useInvoiceFormat } from "./format";
import { InvoiceKindBadge, InvoiceStatusBadge } from "./invoice-status-badge";
import type { ClientInvoicesData } from "./types";

/**
 * Facturas del cliente en su ficha 360: lo pendiente de cobro y lo vencido (con IVA), su
 * facturación neta (base, sin IVA) y las más recientes. Los datos salen de
 * `getClientInvoices(orgId, clientId)` (src/server/invoices/queries.ts).
 */
export function ClientInvoicesCard({
  basePath,
  clientId,
  data,
  canEdit,
}: {
  /** `/{slug}` de la org. */
  basePath: string;
  clientId: string;
  data: ClientInvoicesData;
  /** Socio u owner (y cliente no archivado): puede hacer una factura manual. */
  canEdit: boolean;
}) {
  const t = useTranslations("invoices.clientCard");
  const tList = useTranslations("invoices.list");
  const { money, date } = useInvoiceFormat();
  const newHref = `${basePath}/invoices/new?client=${clientId}`;
  const allHref = `${basePath}/invoices?client=${clientId}`;

  const summary =
    data.totalCount === 0
      ? undefined
      : [
          data.outstandingCents !== 0 ? t("outstanding", { amount: money(data.outstandingCents) }) : t("allPaid"),
          data.overdueCents !== 0 ? t("overdue", { amount: money(data.overdueCents), count: data.overdueCount }) : null,
          data.draftsCount > 0 ? t("drafts", { count: data.draftsCount }) : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <SettingsCard
      title={t("title")}
      description={summary}
      actions={
        canEdit ? (
          <Button asChild variant="outline" size="sm">
            <Link href={newHref}>
              <Plus data-icon="inline-start" />
              {t("new")}
            </Link>
          </Button>
        ) : undefined
      }
      bodyClassName={data.invoices.length > 0 ? "p-0" : undefined}
      footer={
        data.totalCount > 0 ? (
          <>
            <span className="mr-auto text-xs text-muted-foreground tabular">{t("billed", { amount: money(data.billedNetCents) })}</span>
            <Button asChild variant="ghost" size="sm">
              <Link href={allHref}>{t("viewAll", { count: data.totalCount })}</Link>
            </Button>
          </>
        ) : undefined
      }
    >
      {data.invoices.length === 0 ? (
        <div className="text-center">
          <Receipt className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 text-muted-foreground">{t("empty")}</p>
          {canEdit && (
            <Button asChild variant="secondary" size="sm" className="mt-3">
              <Link href={newHref}>
                <Plus data-icon="inline-start" />
                {t("new")}
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <ul className="divide-y">
          {data.invoices.map((invoice) => (
            <li key={invoice.id}>
              <Link
                href={`${basePath}/invoices/${invoice.id}`}
                className="group flex items-center gap-3 px-5 py-2.5 transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p
                      className={cn(
                        "truncate group-hover:text-primary",
                        invoice.number ? "font-mono font-semibold" : "font-semibold text-muted-foreground italic",
                      )}
                    >
                      {invoice.number ?? tList("draft")}
                    </p>
                    <InvoiceKindBadge kind={invoice.kind} />
                  </div>
                  <p className="text-xs text-muted-foreground tabular">
                    {invoice.issuedOn ? date(invoice.issuedOn) : tList("onIssue")}
                    {invoice.status === "overdue" && invoice.dueOn && (
                      <span className="text-destructive"> · {t("dueOn", { date: date(invoice.dueOn) })}</span>
                    )}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold tabular">{money(invoice.totalCents)}</p>
                  {invoice.kind === "ordinary" && (invoice.status === "issued" || invoice.status === "overdue") && (
                    <p className={cn("text-xs tabular", invoice.status === "overdue" ? "text-destructive" : "text-muted-foreground")}>
                      {t("pendingAmount", { amount: money(invoice.outstandingCents) })}
                    </p>
                  )}
                </div>
                <InvoiceStatusBadge status={invoice.status} className="hidden sm:inline-flex" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
