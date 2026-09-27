"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { SettingsCard } from "@/components/settings/settings-card";
import { type AllocationBucket, type AllocationCostRow, COST_PERIODS, type CostPeriod, summarizeAllocations, topClientBuckets } from "@/domain/vendors";
import { cn } from "@/lib/utils";
import { ALLOCATION_FILL, TRACK, useVendorFormat } from "./format";
import { ALLOCATION_ICONS } from "./vendor-kind";

/** Clientes que se enseñan uno a uno; el resto, en una fila («5 clientes más»). */
const MAX_CLIENT_ROWS = 8;

/**
 * «¿Para quién?»: lo que nos ha costado un proveedor para cada destino (nuestra empresa, cada
 * cliente, enlazado a su ficha, y las webs que alojamos), este año o desde siempre. La barra
 * enseña la parte del coste; las cifras van al lado (nunca solo el color).
 */
export function AllocationBreakdown({ rows, basePath, className }: { rows: AllocationCostRow[]; basePath: string; className?: string }) {
  const t = useTranslations("vendors.detail.allocation");
  const fmt = useVendorFormat();
  const [period, setPeriod] = useState<CostPeriod>("total");
  const summary = summarizeAllocations(rows, period);
  const empty = summarizeAllocations(rows, "total").buckets.length === 0;
  const { top, rest } = topClientBuckets(summary, MAX_CLIENT_ROWS);
  const shown = summary.buckets.filter((bucket) => bucket.allocation !== "client" || top.includes(bucket));

  return (
    <SettingsCard
      title={t("title")}
      description={empty ? undefined : t("description")}
      className={className}
      bodyClassName={empty || summary.buckets.length === 0 ? undefined : "px-3 py-3"}
      actions={
        empty ? undefined : (
          <div role="group" aria-label={t("period")} className="flex rounded-full border bg-muted/40 p-0.5 text-[11px] font-semibold">
            {COST_PERIODS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={period === value}
                onClick={() => setPeriod(value)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                  period === value && "bg-background text-foreground shadow-sm ring-1 ring-foreground/10",
                )}
              >
                {t(value)}
              </button>
            ))}
          </div>
        )
      }
    >
      {empty ? (
        <p className="text-center text-muted-foreground">{t("empty")}</p>
      ) : summary.buckets.length === 0 ? (
        <p className="text-center text-muted-foreground">{t("emptyYear")}</p>
      ) : (
        <>
          <ul aria-label={t("caption")} className="space-y-0.5">
            {shown.map((bucket) => (
              <BucketRow key={bucket.key} bucket={bucket} basePath={basePath} fmt={fmt} />
            ))}
            {rest.clients > 0 && (
              <li className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-2.5 px-2 py-2 text-muted-foreground">
                <span aria-hidden />
                <span className="truncate text-sm">{t("otherClients", { count: rest.clients })}</span>
                <span className="text-right">
                  <span className="block text-sm font-semibold tabular">{fmt.money(rest.amountCents)}</span>
                  <span className="block text-[11px] tabular">{fmt.share(rest.shareBps)}</span>
                </span>
              </li>
            )}
          </ul>
          <p className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 border-t px-2 pt-2.5 text-xs text-muted-foreground">
            <span>{t("summary", { count: summary.count, amount: fmt.money(summary.amountCents) })}</span>
            {summary.clientsCount > 0 && <span>{t("clientShare", { share: fmt.share(summary.clientShareBps), count: summary.clientsCount })}</span>}
          </p>
        </>
      )}
    </SettingsCard>
  );
}

function BucketRow({ bucket, basePath, fmt }: { bucket: AllocationBucket; basePath: string; fmt: ReturnType<typeof useVendorFormat> }) {
  const t = useTranslations("vendors.detail.allocation");
  const Icon = ALLOCATION_ICONS[bucket.allocation];
  const label =
    bucket.allocation === "client" ? (bucket.clientName ?? t("unknownClient")) : bucket.allocation === "company" ? t("company") : t("hostedSites");
  const details = [t("expenses", { count: bucket.count }), bucket.pendingCents > 0 ? t("pending", { amount: fmt.money(bucket.pendingCents) }) : null]
    .filter(Boolean)
    .join(" · ");
  const body = (
    <>
      <Icon aria-hidden className="mt-0.5 size-4 text-muted-foreground" />
      <span className="min-w-0">
        <span className={cn("block truncate text-sm font-medium", bucket.allocation === "client" && "group-hover:text-primary")}>{label}</span>
        <span aria-hidden className="mt-1 block h-1.5 overflow-hidden rounded-full" style={{ background: TRACK }}>
          <span className="block h-full rounded-full" style={{ width: `${bucket.shareBps / 100}%`, background: ALLOCATION_FILL[bucket.allocation] }} />
        </span>
        <span className="mt-1 block truncate text-[11px] text-muted-foreground">
          {bucket.allocation === "hosted_sites" ? `${t("hostedSitesHint")} · ${details}` : details}
        </span>
      </span>
      <span className="text-right">
        <span className="block text-sm font-semibold tabular">{fmt.money(bucket.amountCents)}</span>
        <span className="block text-[11px] text-muted-foreground tabular">{fmt.share(bucket.shareBps)}</span>
      </span>
    </>
  );
  const rowClass = "grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-lg px-2 py-2";
  return (
    <li>
      {bucket.allocation === "client" && bucket.clientId ? (
        <Link
          href={`${basePath}/clients/${bucket.clientId}`}
          className={cn(rowClass, "group outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50")}
        >
          {body}
        </Link>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  );
}
