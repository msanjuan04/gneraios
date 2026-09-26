"use client";

import { Receipt } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { SettingsCard } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { useContractFormat } from "./format";
import { InvoiceStatusBadge } from "./status-badges";
import type { ContractDetailData } from "./types";

/** Facturas con alguna línea de este contrato (también rectificativas), con su estado derivado. */
export function InvoicesCard({ data }: { data: ContractDetailData }) {
  const t = useTranslations("contracts.invoices");
  const tKind = useTranslations("billing.invoiceKind");
  const fmt = useContractFormat();
  const { invoices, basePath } = data;

  return (
    <SettingsCard
      title={t("title")}
      description={invoices.length > 0 ? t("count", { count: invoices.length }) : undefined}
      bodyClassName={invoices.length > 0 ? "p-0" : undefined}
    >
      {invoices.length === 0 ? (
        <div className="text-center">
          <Receipt className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        <ul className="divide-y">
          {invoices.map((invoice) => (
            <li key={invoice.id}>
              <Link
                href={`${basePath}/invoices/${invoice.id}`}
                className="group flex items-center gap-3 px-5 py-2.5 transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate font-semibold group-hover:text-primary">
                    <span className="truncate font-mono text-[13px]">{invoice.number ?? t("draft")}</span>
                    {invoice.kind === "rectifying" && <Badge variant="outline">{tKind("rectifying")}</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground tabular">
                    {invoice.issuedOn ? fmt.date(invoice.issuedOn) : t("notIssued")}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-semibold tabular">{fmt.money(invoice.totalCents)}</span>
                  <InvoiceStatusBadge status={invoice.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
