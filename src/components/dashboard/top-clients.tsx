"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SERIES, TRACK } from "./colors";
import { money, share } from "./format";
import type { ConcentrationView, MoneyFormat } from "./types";

type Period = "lastYear" | "allTime";

/**
 * Los clientes que más facturan (neto: base sin IVA, rectificativas restadas) y cuánto depende
 * el negocio del mayor. El aviso salta con el umbral de la org (orgs.settings).
 */
export function TopClients({
  data,
  thresholdBps,
  basePath,
  money: fmt,
  className,
}: {
  data: Record<Period, ConcentrationView>;
  thresholdBps: number;
  basePath: string;
  money: MoneyFormat;
  className?: string;
}) {
  const t = useTranslations("dashboard.topClients");
  const [period, setPeriod] = useState<Period>("lastYear");
  const view = data[period];
  const top = view.rows[0];
  const max = Math.max(1, top?.cents ?? 0);

  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle className="font-semibold">
          <h3>{t("title")}</h3>
        </CardTitle>
        <CardDescription className="text-xs">{t("description")}</CardDescription>
        <CardAction>
          <div role="group" aria-label={t("period")} className="flex rounded-full border bg-muted/40 p-0.5 text-[11px] font-semibold">
            {(["lastYear", "allTime"] as const).map((value) => (
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
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {view.rows.length === 0 ? (
          <p className="flex min-h-32 flex-1 items-center justify-center rounded-lg border border-dashed px-4 text-center text-sm text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <>
            {view.alert && top ? (
              <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs ring-1 ring-warning/25">
                <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-warning" />
                <span>
                  {t("alert", { client: top.name, share: share(view.top1ShareBps, fmt.locale), threshold: share(thresholdBps, fmt.locale) })}
                </span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("healthy", { share: share(view.top3ShareBps, fmt.locale), count: Math.min(3, view.clientsCount) })}
              </p>
            )}
            <ol className="-mx-2 space-y-0.5">
              {view.rows.map((row, index) => (
                <li key={row.clientId}>
                  <Link
                    href={`${basePath}/clients/${row.clientId}`}
                    className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-2 rounded-md px-2 py-1.5 outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span className="text-xs text-muted-foreground tabular">{index + 1}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{row.name}</span>
                      <span aria-hidden className="mt-1 block h-1 overflow-hidden rounded-full" style={{ background: TRACK }}>
                        <span className="block h-full rounded-full" style={{ width: `${(row.cents / max) * 100}%`, background: SERIES.recurring }} />
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block text-sm font-semibold tabular">{money(row.cents, fmt)}</span>
                      <span className="block text-[11px] text-muted-foreground tabular">{share(row.shareBps, fmt.locale)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
            <p className="mt-auto text-xs text-muted-foreground">
              {t("total", { amount: money(view.totalCents, fmt), count: view.clientsCount })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
