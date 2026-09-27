"use client";

import { ArrowUpRight, BellRing } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useFinanceFormat } from "@/components/finance/format";
import { SettingsCard } from "@/components/settings/settings-card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { InfraSubscriptionRow } from "@/domain/finance/infrastructure";
import type { RenewalSettings } from "@/domain/finance/renewals";
import { cn } from "@/lib/utils";

function Tag({ children, className }: { children: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-5 shrink-0 truncate rounded-full border px-1.5 align-middle text-[11px] leading-[1.125rem] font-medium whitespace-nowrap text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** La próxima renovación: la fecha y los días que faltan; resaltada si avisa y cae dentro de los días de aviso. */
function RenewalCell({ row, settings }: { row: InfraSubscriptionRow; settings: RenewalSettings }) {
  const t = useTranslations("infrastructure.renewals");
  const { money, dateMedium } = useFinanceFormat();
  if (!row.running || row.nextRenewalOn === null || row.daysLeft === null) {
    return <span className="text-muted-foreground">{row.isActive ? t("ended") : t("off")}</span>;
  }
  const hint = row.watched ? t("watched", { days: settings.warningDays }) : t("notWatched", { amount: money(settings.monthlyMinCents) });
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 sm:justify-start">
      <span className="tabular">{dateMedium(row.nextRenewalOn)}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={cn(
              "inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[11px] font-semibold whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              row.dueSoon ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground",
            )}
          >
            {row.dueSoon && <BellRing aria-hidden className="size-3" />}
            {t("days", { days: row.daysLeft })}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{hint}</TooltipContent>
      </Tooltip>
      {row.firstCharge && <Tag>{t("firstCharge")}</Tag>}
    </div>
  );
}

/**
 * Las suscripciones de infraestructura con su próxima renovación, de la más cercana a la más lejana
 * (las paradas, al final). Se resalta lo que avisa a los socios y cae dentro de los días de aviso.
 */
export function RenewalsTable({
  rows,
  settings,
  subscriptionsHref,
  className,
}: {
  rows: readonly InfraSubscriptionRow[];
  settings: RenewalSettings;
  subscriptionsHref: string;
  className?: string;
}) {
  const t = useTranslations("infrastructure.renewals");
  const { money } = useFinanceFormat();
  const head = "h-9 text-xs text-muted-foreground";
  return (
    <SettingsCard
      title={t("title")}
      description={t("description", { days: settings.warningDays })}
      className={className}
      bodyClassName="p-0"
      actions={
        <Link
          href={subscriptionsHref}
          className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground focus-visible:underline"
        >
          {t("open")}
          <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      }
    >
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table className="min-w-[40rem]">
          <TableCaption className="sr-only">{t("caption")}</TableCaption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(head, "pl-5")}>{t("columns.subscription")}</TableHead>
              <TableHead className={cn(head, "hidden md:table-cell")}>{t("columns.interval")}</TableHead>
              <TableHead className={cn(head, "text-right")}>{t("columns.charge")}</TableHead>
              <TableHead className={cn(head, "hidden text-right sm:table-cell")}>{t("columns.monthly")}</TableHead>
              <TableHead className={cn(head, "pr-5")}>{t("columns.renewal")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className={cn(!row.running && "text-muted-foreground", row.dueSoon && "bg-warning/5")}>
                <TableCell className="max-w-80 min-w-48 py-2 pl-5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-semibold">{row.description}</span>
                    {row.allocation === "hosted_sites" && <Tag>{t("hosted")}</Tag>}
                    {row.clientName && <Tag className="max-w-40">{row.clientName}</Tag>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {[row.vendorName, row.categoryName].filter((part): part is string => Boolean(part)).join(" · ")}
                  </p>
                </TableCell>
                <TableCell className="hidden text-sm md:table-cell">{t(`intervals.${row.interval}`)}</TableCell>
                <TableCell className="text-right tabular">{money(row.chargeTotalCents)}</TableCell>
                <TableCell className="hidden text-right text-muted-foreground tabular sm:table-cell">{row.running ? money(row.monthlyCents) : "—"}</TableCell>
                <TableCell className="py-2 pr-5">
                  <RenewalCell row={row} settings={settings} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SettingsCard>
  );
}
