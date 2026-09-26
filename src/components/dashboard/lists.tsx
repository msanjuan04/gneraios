import { CalendarClock, CircleCheck, Receipt } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { civilToDate, money } from "./format";
import type { DashboardView } from "./types";

function ListCard({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle className="font-semibold">
          <h3>{title}</h3>
        </CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-32 flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
      {icon}
      {children}
    </div>
  );
}

/** Día y mes en una pastilla: la fecha se lee de un vistazo en la columna. */
async function DateChip({ date, tone = "default" }: { date: string; tone?: "default" | "danger" }) {
  const format = await getFormatter();
  const d = civilToDate(date);
  return (
    <span
      className={cn(
        "flex w-11 shrink-0 flex-col items-center rounded-lg border py-1 leading-none",
        tone === "danger" && "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      <span className="text-[10px] font-semibold tracking-wider uppercase opacity-70">
        {format.dateTime(d, { month: "short" }).replace(".", "")}
      </span>
      <span className="mt-0.5 text-base font-bold tabular">{format.dateTime(d, { day: "numeric" })}</span>
    </span>
  );
}

/** Líneas anuales que renuevan dentro de la ventana de la org (orgs.settings). */
export async function RenewalsCard({ view, className }: { view: DashboardView; className?: string }) {
  const t = await getTranslations("dashboard.renewals");
  return (
    <ListCard title={t("title")} description={t("description", { days: view.renewalWindowDays })} className={className}>
      {view.renewals.length === 0 ? (
        <Empty icon={<CalendarClock aria-hidden className="size-5" />}>{t("empty", { days: view.renewalWindowDays })}</Empty>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {view.renewals.map((r) => (
            <li key={r.lineId}>
              <Link
                href={`${view.basePath}/contracts/${r.contractId}`}
                className="flex items-center gap-3 rounded-md px-2 py-1.5 outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <DateChip date={r.renewsOn} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.clientName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{r.description}</span>
                </span>
                <span className="text-right">
                  <span className="block text-sm font-semibold tabular">{money(r.amountCents, view.money)}</span>
                  <span className={cn("block text-[11px] tabular", r.daysLeft <= 7 ? "font-semibold text-warning" : "text-muted-foreground")}>
                    {t("inDays", { days: r.daysLeft })}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-auto text-xs text-muted-foreground">
        {view.renewals.length > 0
          ? t("footer", { amount: money(view.renewals.reduce((sum, r) => sum + r.amountCents, 0), view.money) })
          : t("footerEmpty")}
      </p>
    </ListCard>
  );
}

/** Facturas vencidas: la que más tiempo lleva vencida, primero. */
export async function OverdueCard({ view, className }: { view: DashboardView; className?: string }) {
  const t = await getTranslations("dashboard.overdue");
  const { rows, count } = view.overdue;
  return (
    <ListCard
      title={t("title")}
      description={t("description")}
      action={
        count > 0 ? (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive tabular">{count}</span>
        ) : undefined
      }
      className={className}
    >
      {rows.length === 0 ? (
        <Empty icon={<CircleCheck aria-hidden className="size-5 text-success" />}>{t("empty")}</Empty>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {rows.map((row) => (
            <li key={row.invoiceId}>
              <Link
                href={`${view.basePath}/invoices/${row.invoiceId}`}
                className="flex items-center gap-3 rounded-md px-2 py-1.5 outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <DateChip date={row.dueOn} tone="danger" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{row.clientName}</span>
                  <span className="block truncate text-xs text-muted-foreground tabular">{row.number}</span>
                </span>
                <span className="text-right">
                  <span className="block text-sm font-semibold tabular">{money(row.outstandingCents, view.money)}</span>
                  <span className="block text-[11px] font-semibold text-destructive tabular">{t("daysOverdue", { days: row.daysOverdue })}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{t("footer")}</span>
        <Link href={`${view.basePath}/invoices`} className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline">
          <Receipt aria-hidden className="size-3.5" />
          {count > rows.length ? t("seeAll", { count }) : t("goInvoices")}
        </Link>
      </div>
    </ListCard>
  );
}
