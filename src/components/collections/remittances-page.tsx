"use client";

import { ArrowRight, Landmark, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { useInvoiceFormat } from "@/components/invoices/format";
import { InvoicesNav } from "@/components/invoices/invoices-nav";
import { PageHeader } from "@/components/page-header";
import { FormField } from "@/components/settings/form-field";
import { ReadOnlyNotice, SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isTargetBusinessDay } from "@/domain/collections";
import { addDays, compareCivil } from "@/domain/dates/civil-date";
import { cn } from "@/lib/utils";
import { CreditorsCard } from "./creditor-card";
import { IssueList, RemittanceStatusBadge } from "./shared";
import type { CreditorSummary, RemittanceListItem } from "./types";

type Props = {
  slug: string;
  basePath: string;
  outboxCount: number;
  remittances: RemittanceListItem[];
  creditors: CreditorSummary[];
  /** Socio u owner: prepara, genera y cobra remesas. */
  canEdit: boolean;
  /** Owner: cambia los datos de acreedor. */
  canEditCreditors: boolean;
  today: string;
  /** Primer día hábil TARGET2 con margen para el banco. */
  defaultCollectionOn: string;
};

/**
 * Remesas de adeudos directos SEPA: preparar una nueva (emisor y fecha de cobro), el listado con su
 * estado y los datos de acreedor de cada emisor.
 */
export function RemittancesPage({
  slug,
  basePath,
  outboxCount,
  remittances,
  creditors,
  canEdit,
  canEditCreditors,
  today,
  defaultCollectionOn,
}: Props) {
  const t = useTranslations("collections");
  const { money, date } = useInvoiceFormat();
  const router = useRouter();
  const href = (id: string) => `${basePath}/invoices/remittances/${id}`;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t("title")} description={t("description")} />
      <InvoicesNav basePath={basePath} outboxCount={outboxCount} />
      {!canEdit && <ReadOnlyNotice className="-mt-2 mb-6">{t("readOnly")}</ReadOnlyNotice>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          {canEdit && (
            <NewRemittanceCard basePath={basePath} creditors={creditors} today={today} defaultCollectionOn={defaultCollectionOn} />
          )}

          <SettingsCard
            title={t("list.title")}
            description={t("list.description", { count: remittances.length })}
            bodyClassName={remittances.length > 0 ? "p-0" : undefined}
          >
            {remittances.length === 0 ? (
              <div className="py-6 text-center">
                <Landmark className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-2 font-semibold">{t("list.emptyTitle")}</p>
                <p className="mt-1 text-muted-foreground">{t("list.emptyBody")}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5 text-xs text-muted-foreground">{t("list.columns.collectionOn")}</TableHead>
                      <TableHead className="text-xs text-muted-foreground">{t("list.columns.issuer")}</TableHead>
                      <TableHead className="hidden text-right text-xs text-muted-foreground sm:table-cell">{t("list.columns.items")}</TableHead>
                      <TableHead className="text-right text-xs text-muted-foreground">{t("list.columns.total")}</TableHead>
                      <TableHead className="hidden text-right text-xs text-muted-foreground md:table-cell">{t("list.columns.returned")}</TableHead>
                      <TableHead className="pr-5 text-xs text-muted-foreground">{t("list.columns.status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {remittances.map((r) => (
                      <TableRow
                        key={r.id}
                        onClick={(e) => {
                          if ((e.target as Element).closest("a")) return;
                          router.push(href(r.id));
                        }}
                        className="cursor-pointer"
                      >
                        <TableCell className="py-2.5 pl-5">
                          <Link href={href(r.id)} className="font-semibold tabular hover:text-primary">
                            {date(r.collectionOn)}
                          </Link>
                          {r.messageId && <p className="font-mono text-[11px] text-muted-foreground">{r.messageId}</p>}
                        </TableCell>
                        <TableCell className="max-w-56 truncate">{r.issuerName}</TableCell>
                        <TableCell className="hidden text-right tabular sm:table-cell">{r.itemsCount}</TableCell>
                        <TableCell className="text-right font-semibold tabular">{money(r.totalCents)}</TableCell>
                        <TableCell className={cn("hidden text-right tabular md:table-cell", r.returnedCount > 0 ? "text-destructive" : "text-muted-foreground")}>
                          {r.returnedCount > 0 ? t("list.returnedValue", { count: r.returnedCount, amount: money(r.returnedCents) }) : "—"}
                        </TableCell>
                        <TableCell className="pr-5">
                          <RemittanceStatusBadge status={r.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </SettingsCard>
        </div>

        <aside className="min-w-0 space-y-6">
          <CreditorsCard slug={slug} creditors={creditors} canEdit={canEditCreditors} />
        </aside>
      </div>
    </div>
  );
}

function NewRemittanceCard({
  basePath,
  creditors,
  today,
  defaultCollectionOn,
}: {
  basePath: string;
  creditors: CreditorSummary[];
  today: string;
  defaultCollectionOn: string;
}) {
  const t = useTranslations("collections.new");
  const router = useRouter();
  const [issuerId, setIssuerId] = useState(creditors[0]?.issuerId ?? "");
  const [collectionOn, setCollectionOn] = useState(defaultCollectionOn);
  const tomorrow = addDays(today, 1);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(collectionOn) && compareCivil(collectionOn, tomorrow) >= 0;
  const creditor = creditors.find((c) => c.issuerId === issuerId);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!issuerId || !validDate) return;
    router.push(`${basePath}/invoices/remittances/new?issuer=${issuerId}&on=${collectionOn}`);
  };

  if (creditors.length === 0) return null;
  return (
    <SettingsCard title={t("title")} description={t("description")}>
      <form onSubmit={submit} className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
        <FormField id="new-issuer" label={t("issuer")}>
          <Select value={issuerId} onValueChange={setIssuerId}>
            <SelectTrigger id="new-issuer" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {creditors.map((c) => (
                <SelectItem key={c.issuerId} value={c.issuerId}>
                  {c.issuerName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField
          id="new-date"
          label={t("collectionOn")}
          error={validDate ? undefined : t("dateInvalid")}
          description={validDate && !isTargetBusinessDay(collectionOn) ? <span className="text-warning">{t("notBusinessDay")}</span> : undefined}
        >
          <Input id="new-date" type="date" min={tomorrow} value={collectionOn} onChange={(e) => setCollectionOn(e.target.value)} className="tabular" />
        </FormField>
        <Button type="submit" className="sm:mt-6" disabled={!issuerId || !validDate}>
          <Search data-icon="inline-start" />
          {t("submit")}
          <ArrowRight data-icon="inline-end" />
        </Button>
      </form>
      {creditor && creditor.source !== "confirmed" && (
        <IssueList issues={["creditorIdUnconfirmed"]} tone="warning" className="mt-3" />
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t("hint")}</p>
    </SettingsCard>
  );
}
