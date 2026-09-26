import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { formatMoney } from "@/domain/money";
import type { FunnelSummary } from "@/domain/pipeline";

type Tile = { key: string; label: string; value: ReactNode; hint: string };

/**
 * Cifras de cabecera. Los creados van por fecha de creación y el resto por fecha de cierre.
 * Lo puntual y lo recurrente van en tarjetas separadas: nunca se suman.
 */
export async function FunnelKpis({
  totals,
  allTime,
  money,
}: {
  totals: FunnelSummary;
  allTime: boolean;
  money: { locale: string; currency: string };
}) {
  const t = await getTranslations("funnel.kpi");
  const format = await getFormatter();
  const count = (value: number) => format.number(value, { useGrouping: "always" });
  const closed = totals.won + totals.lost;
  const closedHint = allTime ? t("closedHintAll") : t("closedHint");

  const tiles: Tile[] = [
    {
      key: "created",
      label: t("created"),
      value: count(totals.created),
      hint: allTime ? t("createdHintAll") : t("createdHint"),
    },
    { key: "won", label: t("won"), value: count(totals.won), hint: closedHint },
    { key: "lost", label: t("lost"), value: count(totals.lost), hint: closedHint },
    {
      key: "closeRate",
      label: t("closeRate"),
      value:
        totals.closeRate === null ? "—" : format.number(totals.closeRate, { style: "percent", maximumFractionDigits: 0 }),
      hint:
        closed > 0
          ? t("closeRateHint", { won: totals.won, closed })
          : allTime
            ? t("closeRateNoneAll")
            : t("closeRateNone"),
    },
    {
      key: "wonOneOff",
      label: t("wonOneOff"),
      value: formatMoney(totals.wonOneOffCents, { ...money, wholeUnits: true }),
      hint: t("wonOneOffHint"),
    },
    {
      key: "wonMrr",
      label: t("wonMrr"),
      value: t.rich("perMonth", {
        amount: formatMoney(totals.wonMrrCents, { ...money, wholeUnits: true }),
        unit: (chunks) => <span className="text-base font-semibold text-muted-foreground">{chunks}</span>,
      }),
      hint: t("wonMrrHint"),
    },
  ];

  return (
    <section aria-label={t("label")} className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
      {tiles.map((tile) => (
        <Card key={tile.key} className="@container gap-1.5">
          <CardHeader>
            <CardDescription className="text-[11px] font-semibold tracking-wider uppercase">{tile.label}</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Cifra suelta y grande: dígitos proporcionales, no tabulares. Se encoge en tarjetas estrechas. */}
            <p className="text-lg font-extrabold heading-tight [overflow-wrap:anywhere] @[12rem]:text-xl @[16rem]:text-2xl">
              {tile.value}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">{tile.hint}</p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
