import { TrendingDown, TrendingUp } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Mover } from "@/domain/seo";
import { cn } from "@/lib/utils";
import { Delta, directionOf } from "./delta";
import { formatCount, formatPosition, type Formatter } from "./format";

function MoverList({ movers, format, empty }: { movers: Mover[]; format: Formatter; empty: string }) {
  if (movers.length === 0) return <p className="py-3 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y">
      {movers.map((m) => (
        <li key={m.key} className="flex items-center gap-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate" title={m.key}>
            {m.key}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular">
            {m.comparePosition !== null && m.position !== null
              ? `${formatPosition(format, m.comparePosition)} → ${formatPosition(format, m.position)}`
              : m.position !== null
                ? formatPosition(format, m.position)
                : ""}
          </span>
          <Delta tone={m.clicksDelta > 0 ? "good" : "bad"} direction={directionOf(m.clicksDelta)} className="w-14 shrink-0 justify-end text-xs">
            {format.number(m.clicksDelta, { signDisplay: "exceptZero" })}
          </Delta>
        </li>
      ))}
    </ul>
  );
}

/** Las consultas que más clics ganan y pierden frente al periodo de comparación. */
export async function MoversCard({
  winners,
  losers,
  comparable,
  className,
}: {
  winners: Mover[];
  losers: Mover[];
  comparable: boolean;
  className?: string;
}) {
  const t = await getTranslations("seo.movers");
  const format = await getFormatter();
  const gained = winners.reduce((sum, m) => sum + m.clicksDelta, 0);
  const lost = losers.reduce((sum, m) => sum + m.clicksDelta, 0);

  return (
    <Card className={cn("gap-3", className)}>
      <CardHeader>
        <CardTitle className="font-semibold">
          <h2>{t("title")}</h2>
        </CardTitle>
        <CardDescription className="text-xs">{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!comparable ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{t("noCompare")}</p>
        ) : (
          <>
            <section aria-label={t("up")}>
              <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                <TrendingUp aria-hidden className="size-3.5 text-success" />
                {t("up")}
                {gained > 0 && <span className="ml-auto font-medium tracking-normal normal-case tabular">{t("total", { value: `+${formatCount(format, gained)}` })}</span>}
              </h3>
              <MoverList movers={winners} format={format} empty={t("noneUp")} />
            </section>
            <section aria-label={t("down")}>
              <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                <TrendingDown aria-hidden className="size-3.5 text-destructive" />
                {t("down")}
                {lost < 0 && <span className="ml-auto font-medium tracking-normal normal-case tabular">{t("total", { value: formatCount(format, lost) })}</span>}
              </h3>
              <MoverList movers={losers} format={format} empty={t("noneDown")} />
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
