import { ArrowRight, Building2 } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ClientStatusBadge } from "@/components/clients/client-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/domain/money";
import { cn } from "@/lib/utils";
import type { ClientRelation } from "@/server/seo/queries";
import { Delta, directionOf } from "./delta";
import { formatChange, formatCount, formatDay, formatRange, toneOf } from "./format";

/**
 * La web de un cliente, atada al CRM: quién es, cuánto se le ha facturado y cómo ha cambiado su
 * tráfico desde que se trabaja con él (los primeros 28 días con datos desde su primera factura
 * frente a los últimos 28). Es el argumento de una renovación.
 */
export async function ClientRelationCard({
  relation,
  basePath,
  money,
  className,
}: {
  relation: ClientRelation;
  basePath: string;
  money: { locale: string; currency: string };
  className?: string;
}) {
  const t = await getTranslations("seo.client");
  const format = await getFormatter();
  const since = relation.sinceStart;

  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-semibold">
          <Building2 aria-hidden className="size-4 text-primary" />
          <h2 className="min-w-0 truncate">{relation.name}</h2>
          <ClientStatusBadge status={relation.status} />
        </CardTitle>
        <CardDescription className="text-xs">{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-muted/50 px-3 py-2.5">
            <dt className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("billed")}</dt>
            <dd className="mt-0.5 text-xl font-extrabold heading-tight">{formatMoney(Math.round(relation.billedNetCents / 100) * 100, { ...money, wholeUnits: true })}</dd>
          </div>
          <div className="rounded-xl bg-muted/50 px-3 py-2.5">
            <dt className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("since")}</dt>
            <dd className="mt-0.5 text-xl font-extrabold heading-tight">
              {relation.firstInvoiceOn ? formatDay(format, relation.firstInvoiceOn, true) : "—"}
            </dd>
          </div>
        </dl>

        {since ? (
          <div className="rounded-xl border px-3 py-2.5">
            <p className="text-xs text-muted-foreground">{since.fromStart ? t("sinceStart") : t("sinceData")}</p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="tabular">{t("clicksFrom", { value: formatCount(format, since.before) })}</span>
              <ArrowRight aria-hidden className="size-3.5 self-center text-muted-foreground" />
              <span className="text-base font-bold tabular">{t("clicksTo", { value: formatCount(format, since.now) })}</span>
              {since.change !== null && (
                <Delta tone={toneOf(since.change, 0.02)} direction={directionOf(since.change)} className="text-xs">
                  {formatChange(format, since.change)}
                </Delta>
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground tabular">
              {t("windows", { from: formatRange(format, since.from), to: formatRange(format, since.to) })}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noHistory")}</p>
        )}

        <Button asChild variant="outline" size="sm">
          <Link href={`${basePath}/clients/${relation.clientId}`}>
            {t("open")}
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
