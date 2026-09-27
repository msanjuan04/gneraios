import { Megaphone } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TrafficChannels } from "@/domain/seo";
import { cn } from "@/lib/utils";
import { SEO_ACCENT, SEO_MUTED } from "./chart-colors";
import { Delta, directionOf } from "./delta";
import { formatChange, formatCount, formatPercent } from "./format";

/*
 * De dónde vienen las visitas (GA4, por canal). Misma forma "énfasis" que el resto del SEO: los
 * canales de pago (Google Ads, Meta…) en el azul de marca y el resto en gris; nada de ocho colores
 * que no se distinguen. Cada fila: su barra de peso, las sesiones, la variación y lo que convierte.
 */
export async function ChannelsCard({ data, comparable, className }: { data: TrafficChannels; comparable: boolean; className?: string }) {
  const t = await getTranslations("seo.channels");
  const format = await getFormatter();
  const max = Math.max(...data.rows.map((r) => r.share), 0.0001);

  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle className="font-semibold">
          <h3>{t("title")}</h3>
        </CardTitle>
        <CardDescription className="text-xs">{t("description")}</CardDescription>
        {data.paid.sessions > 0 && (
          <CardAction>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary tabular">
              <Megaphone aria-hidden className="size-3.5" />
              {t("paidPill", { share: formatPercent(format, data.paid.share, 0) })}
            </span>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("title")}</caption>
          <thead>
            <tr className="text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              <th scope="col" className="pb-2 font-semibold">
                {t("channel")}
              </th>
              <th scope="col" className="hidden w-2/5 pb-2 font-semibold sm:table-cell">
                <span className="sr-only">{t("share")}</span>
              </th>
              <th scope="col" className="pb-2 text-right font-semibold">
                {t("sessions")}
              </th>
              {comparable && (
                <th scope="col" className="pb-2 text-right font-semibold">
                  {t("change")}
                </th>
              )}
              <th scope="col" className="pb-2 text-right font-semibold">
                {t("conversions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.rows.map((row) => (
              <tr key={row.channel}>
                <th scope="row" className="py-2 pr-3 text-left font-medium">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: row.paid ? SEO_ACCENT : SEO_MUTED }} />
                    {t(`names.${row.channel}`)}
                  </span>
                </th>
                <td className="hidden py-2 pr-3 sm:table-cell">
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${(row.share / max) * 100}%`, background: row.paid ? SEO_ACCENT : SEO_MUTED }}
                      />
                    </span>
                    <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular">{formatPercent(format, row.share, 0)}</span>
                  </span>
                </td>
                <td className="py-2 text-right font-semibold tabular">{formatCount(format, row.sessions)}</td>
                {comparable && (
                  <td className="py-2 text-right">
                    {row.change === null ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <Delta tone={row.change >= 0 ? "good" : "bad"} direction={directionOf(row.change)} className="justify-end text-xs">
                        {formatChange(format, row.change)}
                      </Delta>
                    )}
                  </td>
                )}
                <td className="py-2 text-right tabular">
                  <span className="font-medium">{formatCount(format, row.conversions)}</span>
                  {row.conversionRate !== null && row.sessions > 0 && (
                    <span className="ml-1 text-xs text-muted-foreground">({formatPercent(format, row.conversionRate)})</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">
          {data.paid.sessions > 0
            ? t("paidSummary", {
                sessions: formatCount(format, data.paid.sessions),
                conversions: formatCount(format, data.paid.conversions),
                change: data.paid.change === null ? "" : formatChange(format, data.paid.change),
                hasChange: data.paid.change === null ? "no" : "yes",
              })
            : t("noPaid")}{" "}
          {t("footnote")}
        </p>
      </CardContent>
    </Card>
  );
}
