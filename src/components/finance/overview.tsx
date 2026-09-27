import { ArrowUpRight, CalendarClock, Landmark, Scale, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Delta, directionOf } from "@/components/dashboard/delta";
import { civilToDate, money, share, signedMoney } from "@/components/dashboard/format";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { addDays, compareCivil, daysBetween } from "@/domain/dates/civil-date";
import type { FinanceSnapshot, TaxQuarterView } from "@/domain/finance";
import { monthOf } from "@/domain/metrics/months";
import { cn } from "@/lib/utils";
import { ForecastCard } from "./forecast-card";
import { PnlChart } from "./pnl-chart";
import type { MoneyFormat } from "./types";

/** Días de «próximos pagos». */
const UPCOMING_DAYS = 30;
const UPCOMING_LIMIT = 8;

type Props = {
  snapshot: FinanceSnapshot;
  basePath: string;
  money: MoneyFormat;
  issuerNames: Record<string, string>;
};

function ArrowLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="-m-1 flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <ArrowUpRight className="size-4" />
    </Link>
  );
}

function Kpi({ label, tag, action, children, className }: { label: string; tag?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("@container gap-3", className)}>
      <CardHeader>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold tracking-wider uppercase">
          <span>{label}</span>
          {tag && <span className="rounded-full border px-1.5 py-px text-[10px] font-semibold tracking-normal normal-case">{tag}</span>}
        </CardDescription>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">{children}</CardContent>
    </Card>
  );
}

function Figure({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-3xl font-extrabold heading-tight [overflow-wrap:anywhere] @[18rem]:text-4xl", className)}>{children}</p>;
}

async function Kpis({ snapshot, basePath, money: fmt }: Props) {
  const t = await getTranslations("finance.overview.kpi");
  const format = await getFormatter();
  const date = (d: string) => format.dateTime(civilToDate(d), { day: "numeric", month: "short" });
  const monthName = (m: string) => format.dateTime(civilToDate(m), { month: "long" });
  const perMonth = (amount: string) =>
    t.rich("perMonth", {
      amount,
      unit: (chunks) => <span className="ml-0.5 text-[0.45em] font-bold tracking-normal text-muted-foreground">{chunks}</span>,
    });
  const { cash, burn, fixedCosts, runwayMonths } = snapshot;

  // El último mes cerrado y el anterior, para el margen.
  const current = monthOf(snapshot.today);
  const closed = snapshot.months.filter((m) => m.month < current);
  const last = closed.at(-1);
  const before = closed.at(-2);

  return (
    <section aria-label={t("label")} className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Kpi label={t("cash")} action={<ArrowLink href={`${basePath}/finance/cash`} label={t("goCash")} />}>
        {cash.activeAccounts === 0 ? (
          <>
            <Figure className="text-muted-foreground">—</Figure>
            <p className="mt-2 text-xs text-muted-foreground">{t("cashNone")}</p>
          </>
        ) : (
          <>
            <Figure className={cn(cash.estimatedCents < 0 && "text-destructive")}>{money(cash.estimatedCents, fmt)}</Figure>
            <p className="mt-2 text-xs text-muted-foreground">
              {cash.latestOn
                ? t("cashRecorded", { amount: money(cash.recordedCents, fmt), date: date(cash.latestOn) })
                : t("cashNoBalance")}
            </p>
            {cash.movementsCents !== 0 && (
              <p className="mt-0.5 text-xs text-muted-foreground">{t("cashMovements", { amount: signedMoney(cash.movementsCents, fmt) })}</p>
            )}
            {cash.oldestOn && cash.latestOn && cash.oldestOn !== cash.latestOn && (
              <p className="mt-auto pt-3 text-xs text-warning">{t("cashMixedDates", { from: date(cash.oldestOn) })}</p>
            )}
          </>
        )}
      </Kpi>

      <Kpi label={t("runway")} tag={t("runwayTag")}>
        <Figure>{runwayMonths === null ? "—" : t("months", { count: runwayMonths, value: format.number(runwayMonths, { maximumFractionDigits: 1 }) })}</Figure>
        <p className="mt-2 text-xs text-muted-foreground">
          {fixedCosts.source === "none"
            ? t("fixedNone")
            : t(fixedCosts.source === "history" ? "fixedHistory" : "fixedSubscriptions", {
                amount: money(fixedCosts.monthlyCents, fmt),
                months: burn?.months.length ?? 0,
              })}
        </p>
        <p className="mt-auto pt-3 text-xs text-muted-foreground">{t("runwayHint")}</p>
      </Kpi>

      <Kpi label={t("burn")} tag={t("burnTag")} action={<ArrowLink href={`${basePath}/finance/expenses`} label={t("goExpenses")} />}>
        {burn === null ? (
          <>
            <Figure className="text-muted-foreground">—</Figure>
            <p className="mt-2 text-xs text-muted-foreground">{t("burnNone")}</p>
          </>
        ) : (
          <>
            <Figure>{perMonth(money(burn.expensesCents, fmt))}</Figure>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("burnWindow", { count: burn.months.length, revenue: money(burn.revenueCents, fmt) })}
            </p>
            <p className={cn("mt-auto pt-3 text-xs font-semibold", burn.netBurnCents > 0 ? "text-destructive" : "text-success")}>
              {burn.netBurnCents > 0 ? t("netBurn", { amount: money(burn.netBurnCents, fmt) }) : t("netPositive", { amount: money(burn.marginCents, fmt) })}
            </p>
          </>
        )}
      </Kpi>

      <Kpi label={last ? t("margin", { month: monthName(last.month) }) : t("marginEmpty")} tag={t("marginTag")}>
        {last ? (
          <>
            <Figure className={cn(last.marginCents < 0 && "text-destructive")}>{money(last.marginCents, fmt)}</Figure>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              {last.marginBps !== null && <span className="text-xs font-semibold tabular">{t("marginShare", { share: share(last.marginBps, fmt.locale) })}</span>}
              {before && (
                <Delta direction={directionOf(last.marginCents - before.marginCents)}>
                  {t("marginDelta", { delta: signedMoney(last.marginCents - before.marginCents, fmt), month: monthName(before.month) })}
                </Delta>
              )}
            </div>
            <p className="mt-auto pt-3 text-xs text-muted-foreground">
              {last.hasExpenses
                ? t("marginBreakdown", { revenue: money(last.revenueCents, fmt), expenses: money(last.expensesCents, fmt) })
                : t("marginNoExpenses")}
            </p>
          </>
        ) : (
          <Figure className="text-muted-foreground">—</Figure>
        )}
      </Kpi>
    </section>
  );
}

function ListCard({
  title,
  description,
  icon,
  action,
  className,
  children,
}: {
  title: string;
  description?: string;
  icon: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-semibold">
          <span aria-hidden className="text-muted-foreground">
            {icon}
          </span>
          <h3>{title}</h3>
        </CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

async function TaxCard({ quarters, issuerNames, money: fmt, basePath }: { quarters: TaxQuarterView[]; issuerNames: Record<string, string>; money: MoneyFormat; basePath: string }) {
  const t = await getTranslations("finance.taxes");
  const format = await getFormatter();
  const date = (d: string) => format.dateTime(civilToDate(d), { day: "numeric", month: "long" });
  const name = (id: string) => issuerNames[id] ?? t("unknownIssuer");

  return (
    <ListCard
      title={t("title")}
      description={t("description")}
      icon={<Scale className="size-4" />}
      action={<ArrowLink href={`${basePath}/finance/expenses`} label={t("goExpenses")} />}
    >
      <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
        <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
        <span>{t("estimateNote")}</span>
      </p>
      {quarters.map((q) => {
        const withholding = q.withholdings.totalCents;
        const forecastVat = q.vat.issuers.reduce((sum, i) => sum + i.forecastOutputVatCents - i.forecastInputVatCents, 0);
        return (
          <section key={q.key} className="rounded-xl border">
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b px-3 py-2">
              <h4 className="font-semibold">
                {t("quarter", { quarter: q.quarter.quarter, year: String(q.quarter.year) })}
                <span className="ml-2 text-xs font-normal text-muted-foreground">{q.closed ? t("closed") : t("inProgress")}</span>
              </h4>
              <span className="text-xs text-muted-foreground">{t("dueOn", { date: date(q.dueOn) })}</span>
            </header>
            {q.vat.issuers.length === 0 && withholding === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">{t("nothing")}</p>
            ) : (
              <div className="divide-y">
                {q.vat.issuers.map((issuer) => (
                  <div key={issuer.issuerId} className="grid gap-1 px-3 py-2.5 text-xs">
                    <p className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate font-medium">{t("vatOf", { issuer: name(issuer.issuerId) })}</span>
                      <span className={cn("font-bold tabular", issuer.resultCents < 0 && "text-success")}>
                        {issuer.resultCents >= 0 ? money(issuer.payableCents, fmt) : t("toCompensate", { amount: money(-issuer.resultCents, fmt) })}
                      </span>
                    </p>
                    <p className="flex justify-between gap-3 text-muted-foreground">
                      <span>{t("output")}</span>
                      <span className="tabular">{money(issuer.outputVatCents, fmt)}</span>
                    </p>
                    <p className="flex justify-between gap-3 text-muted-foreground">
                      <span>{t("input")}</span>
                      <span className="tabular">−{money(issuer.inputVatCents, fmt)}</span>
                    </p>
                  </div>
                ))}
                {q.withholdings.issuers.map((issuer) => (
                  <p key={`w-${issuer.issuerId}`} className="flex items-baseline justify-between gap-3 px-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{t("withholdingsOf", { issuer: name(issuer.issuerId) })}</span>
                      <span className="block text-xs text-muted-foreground">{t("withholdingsHint")}</span>
                    </span>
                    <span className="font-bold tabular">{money(issuer.withheldCents, fmt)}</span>
                  </p>
                ))}
              </div>
            )}
            {forecastVat !== 0 && (
              <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">{t("forecastIncluded", { amount: signedMoney(forecastVat, fmt) })}</p>
            )}
          </section>
        );
      })}
    </ListCard>
  );
}

async function AccountsCard({ snapshot, issuerNames, money: fmt, basePath }: Props) {
  const t = await getTranslations("finance.overview.accounts");
  const format = await getFormatter();
  const date = (d: string) => format.dateTime(civilToDate(d), { day: "numeric", month: "short", year: "numeric" });
  const accounts = snapshot.cash.accounts.filter((a) => a.isActive);
  return (
    <ListCard
      title={t("title")}
      description={t("description")}
      icon={<Landmark className="size-4" />}
      action={<ArrowLink href={`${basePath}/finance/cash`} label={t("goCash")} />}
    >
      {accounts.length === 0 ? (
        <div className="flex min-h-32 flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          <Landmark aria-hidden className="size-5" />
          <p>{t("empty")}</p>
          <Link href={`${basePath}/finance/cash`} className="text-xs font-semibold text-primary hover:underline">
            {t("add")}
          </Link>
        </div>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {accounts.map((a) => {
            const age = a.balanceOn ? daysBetween(a.balanceOn, snapshot.today) : null;
            return (
              <li key={a.accountId} className="flex items-center gap-3 rounded-md px-2 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{a.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{issuerNames[a.issuerId] ?? ""}</span>
                </span>
                <span className="text-right">
                  <span className={cn("block text-sm font-semibold tabular", (a.balanceCents ?? 0) < 0 && "text-destructive")}>
                    {a.balanceCents === null ? "—" : money(a.balanceCents, fmt)}
                  </span>
                  <span className="block text-[11px] text-muted-foreground tabular">
                    {a.balanceOn ? (age === 0 ? t("today") : t("asOf", { date: date(a.balanceOn), days: age ?? 0 })) : t("noBalance")}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-auto flex items-baseline justify-between gap-3 border-t pt-3 text-sm">
        <span className="text-muted-foreground">{t("total")}</span>
        <span className="font-bold tabular">{money(snapshot.cash.recordedCents, fmt)}</span>
      </div>
    </ListCard>
  );
}

async function UpcomingCard({ snapshot, money: fmt, basePath }: Props) {
  const t = await getTranslations("finance.overview.upcoming");
  const tTax = await getTranslations("finance.taxes");
  const format = await getFormatter();
  const until = addDays(snapshot.today, UPCOMING_DAYS);
  const outflows = snapshot.forecast.flows.filter((f) => f.cents < 0 && compareCivil(f.on, until) <= 0);
  const shown = outflows.slice(0, UPCOMING_LIMIT);
  const quarterLabel = (key: string) => {
    const [year, q] = key.split("-Q");
    return tTax("quarter", { quarter: Number(q), year: String(year) });
  };
  const label = (kind: string, text: string) =>
    kind === "vat" ? t("vat", { quarter: quarterLabel(text) }) : kind === "withholding" ? t("withholding", { quarter: quarterLabel(text) }) : text;

  return (
    <ListCard
      title={t("title")}
      description={t("description", { days: UPCOMING_DAYS })}
      icon={<CalendarClock className="size-4" />}
      action={<ArrowLink href={`${basePath}/finance/expenses?status=pending`} label={t("goExpenses")} />}
    >
      {shown.length === 0 ? (
        <p className="flex min-h-32 flex-1 items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {t("empty", { days: UPCOMING_DAYS })}
        </p>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {shown.map((flow, i) => {
            const d = civilToDate(flow.on);
            return (
              <li key={`${flow.kind}-${flow.refId}-${i}`} className="flex items-center gap-3 rounded-md px-2 py-1.5">
                <span
                  className={cn(
                    "flex w-11 shrink-0 flex-col items-center rounded-lg border py-1 leading-none",
                    flow.overdue && "border-destructive/30 bg-destructive/10 text-destructive",
                  )}
                >
                  <span className="text-[10px] font-semibold tracking-wider uppercase opacity-70">
                    {format.dateTime(d, { month: "short" }).replace(".", "")}
                  </span>
                  <span className="mt-0.5 text-base font-bold tabular">{format.dateTime(d, { day: "numeric" })}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{label(flow.kind, flow.label)}</span>
                  <span className={cn("block text-xs", flow.overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>
                    {flow.overdue ? t("overdue") : t(`kinds.${flow.kind}`)}
                  </span>
                </span>
                <span className="text-sm font-semibold tabular">{money(-flow.cents, fmt)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-auto text-xs text-muted-foreground">
        {outflows.length > 0
          ? t("footer", { count: outflows.length, amount: money(-outflows.reduce((sum, f) => sum + f.cents, 0), fmt) })
          : t("footerEmpty")}
      </p>
    </ListCard>
  );
}

/** La foto financiera: caja, runway, burn y margen; 12 meses; previsión a 90 días e impuestos; cuentas y pagos. */
export async function FinanceOverview(props: Props) {
  const { snapshot, money: fmt } = props;
  return (
    <div className="space-y-6">
      <Kpis {...props} />
      <PnlChart months={snapshot.months} money={fmt} />
      <ForecastCard forecast={snapshot.forecast} money={fmt} />
      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <TaxCard quarters={snapshot.taxes.quarters} issuerNames={props.issuerNames} money={fmt} basePath={props.basePath} />
        <UpcomingCard {...props} />
        <AccountsCard {...props} />
      </section>
    </div>
  );
}
