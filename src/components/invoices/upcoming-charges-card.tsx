import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { addDays, compareCivil, type CivilDate } from "@/domain/dates/civil-date";
import type { ForecastItem } from "@/domain/billing/forecast";
import { formatMoney } from "@/domain/money";
import { cn } from "@/lib/utils";

type Charge = ForecastItem & { clientName: string };
type Grouped = Charge & { concepts: string[] };

/** Cuántos cobros se ven de entrada; el resto, un clic más abajo. */
const VISIBLE = 10;

/**
 * Lo que va a entrar, cobro a cobro y por fecha: cada mensualidad, cada anualidad y cada hito de
 * pago, con su cliente y su importe (sin IVA), HAYA FACTURA O NO. Es el calendario real con el que
 * factura el cron, así que si algo no tiene factura todavía, aquí se ve cuándo hay que hacerla.
 */
/** Los conceptos de un mismo contrato que se cobran el mismo día son un solo cobro (UDB: 1.050 + 95 + 30 = 1.175). */
function groupCharges(charges: Charge[]): (Charge & { concepts: string[] })[] {
  const groups = new Map<string, Charge & { concepts: string[] }>();
  for (const charge of charges) {
    const key = `${charge.contractId}|${charge.date}|${charge.kind}`;
    const existing = groups.get(key);
    const concept = charge.description ?? charge.contractTitle ?? "";
    if (existing) {
      existing.cents += charge.cents;
      if (concept) existing.concepts.push(concept);
    } else {
      groups.set(key, { ...charge, concepts: concept ? [concept] : [] });
    }
  }
  return [...groups.values()];
}

export async function UpcomingChargesCard({ charges: raw, basePath, today }: { charges: Charge[]; basePath: string; today: CivilDate }) {
  const charges = groupCharges(raw);
  const t = await getTranslations("invoices.upcoming");
  const format = await getFormatter();
  const money = (cents: number) => formatMoney(cents, { wholeUnits: true });
  const day = (date: CivilDate) => format.dateTime(new Date(`${date}T12:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" });
  const soon = addDays(today, 7);
  const next30 = addDays(today, 30);

  const dueNow = charges.filter((charge) => charge.overdue || compareCivil(charge.date, today) <= 0);
  const in30 = charges.filter((charge) => compareCivil(charge.date, today) > 0 && compareCivil(charge.date, next30) <= 0);
  const sum = (list: Grouped[]) => list.reduce((total, charge) => total + charge.cents, 0);

  const byMonth = new Map<string, Grouped[]>();
  for (const charge of charges) {
    const key = charge.date.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), charge]);
  }

  const row = (charge: Grouped) => {
    const status = charge.overdue ? "overdue" : compareCivil(charge.date, today) <= 0 ? "today" : compareCivil(charge.date, soon) <= 0 ? "soon" : "planned";
    return (
      <li key={`${charge.refId}-${charge.date}`} className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-5 py-3 sm:grid-cols-[3.5rem_minmax(0,1fr)_7rem_auto]">
        <time className="text-sm font-bold tabular-nums" dateTime={charge.date}>
          {day(charge.date)}
        </time>
        <div className="min-w-0">
          <Link href={`${basePath}/clients/${charge.clientId ?? ""}`} className="block truncate text-sm font-semibold hover:text-primary">
            {charge.clientName}
          </Link>
          <p className="truncate text-xs text-muted-foreground" title={charge.concepts.join(" · ")}>
            {charge.concepts.length > 1
              ? t("concepts", { count: charge.concepts.length - 1, first: charge.concepts[0] ?? "" })
              : (charge.concepts[0] ?? charge.contractTitle ?? t(`kind.${charge.kind}`))}
          </p>
        </div>
        <span className="hidden text-xs text-muted-foreground sm:block">{t(`kind.${charge.kind}`)}</span>
        <div className="text-right">
          <p className="text-sm font-bold tabular-nums">{money(charge.cents)}</p>
          <p
            className={cn(
              "text-[11px] font-semibold",
              status === "overdue" && "text-destructive",
              status === "today" && "text-amber-600 dark:text-amber-400",
              status === "soon" && "text-primary",
              status === "planned" && "text-muted-foreground",
            )}
          >
            {t(`status.${status}`)}
          </p>
        </div>
      </li>
    );
  };

  if (charges.length === 0) {
    return (
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("empty")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const first = charges.slice(0, VISIBLE);
  const rest = charges.slice(VISIBLE);
  const monthLabel = (key: string) => format.dateTime(new Date(`${key}-01T12:00:00Z`), { month: "long", year: "numeric", timeZone: "UTC" });
  const groups = (list: Grouped[]) => {
    const keys = [...new Set(list.map((charge) => charge.date.slice(0, 7)))];
    return keys.map((key) => (
      <li key={key}>
        <div className="flex items-baseline justify-between border-y bg-muted/30 px-5 py-1.5">
          <p className="text-xs font-bold capitalize tracking-wide text-muted-foreground">{monthLabel(key)}</p>
          <p className="text-xs font-semibold tabular-nums text-muted-foreground">{t("monthTotal", { amount: money(sum(byMonth.get(key) ?? [])) })}</p>
        </div>
        <ul className="divide-y">{list.filter((charge) => charge.date.startsWith(key)).map(row)}</ul>
      </li>
    ));
  };

  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4 text-primary" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <p className="text-xs text-muted-foreground">{t("dueNow")}</p>
            <p className={cn("text-xl font-extrabold tabular-nums", dueNow.length > 0 && "text-amber-600 dark:text-amber-400")}>{money(sum(dueNow))}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("next30")}</p>
            <p className="text-xl font-extrabold tabular-nums">{money(sum(in30))}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("total")}</p>
            <p className="text-xl font-extrabold tabular-nums">{money(sum(charges))}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ul>{groups(first)}</ul>
        {rest.length > 0 && (
          <details className="group border-t">
            <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-primary hover:underline">{t("showMore", { count: rest.length })}</summary>
            <ul>{groups(rest)}</ul>
          </details>
        )}
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">{t("hint")}</p>
      </CardContent>
    </Card>
  );
}
