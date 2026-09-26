import { Activity, FileText, Mail, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VERIFACTU_COUNTDOWN_DAYS } from "@/domain/fiscal/verifactu";
import { CRON_STALE_HOURS } from "@/domain/metrics";
import { cn } from "@/lib/utils";
import { TRACK } from "./colors";
import { civilToDate } from "./format";
import type { DashboardView } from "./types";

/**
 * Salud del sistema: el cron diario (aviso si el último OK tiene más de 26 h), la cuenta atrás
 * de Verifactu de cada emisor que aún usa el proveedor interno y lo que espera a un socio.
 */
export async function HealthCard({ view, className }: { view: DashboardView; className?: string }) {
  const t = await getTranslations("dashboard.health");
  const format = await getFormatter();
  const { cron, verifactu, drafts, remindersToApprove } = view.health;
  const lastOk = cron.lastSuccessAt ? new Date(cron.lastSuccessAt) : null;
  const failedAfterOk = cron.lastRun?.status === "failed";

  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle className="font-semibold">
          <h3>{t("title")}</h3>
        </CardTitle>
        <CardDescription className="text-xs">{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-5">
        {/* Cron diario */}
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full",
              cron.state === "ok" ? "bg-success/12 text-success" : "bg-warning/15 text-warning",
            )}
          >
            {cron.state === "ok" ? <Activity aria-hidden className="size-4" /> : <TriangleAlert aria-hidden className="size-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {cron.state === "ok" ? t("cronOk") : cron.state === "stale" ? t("cronStale", { hours: CRON_STALE_HOURS }) : t("cronNever")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {lastOk
                ? t("cronLast", {
                    when: format.dateTime(lastOk, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
                    ago: format.relativeTime(lastOk, new Date(view.health.checkedAt)),
                  })
                : t("cronLastNone")}
            </p>
            {failedAfterOk && cron.lastRun?.error && (
              <p className="mt-1 line-clamp-2 text-xs text-destructive">{t("cronError", { error: cron.lastRun.error })}</p>
            )}
          </div>
          <Link
            href={`${view.basePath}/invoices`}
            className="shrink-0 text-xs font-semibold text-primary underline-offset-4 hover:underline"
          >
            {t("cronAction")}
          </Link>
        </div>

        {/* Verifactu por emisor */}
        {verifactu.length > 0 && (
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              <ShieldCheck aria-hidden className="size-3.5" />
              {t("verifactu")}
            </p>
            <ul className="mt-2 space-y-3">
              {verifactu.map((row) => {
                const { state, daysLeft } = row.countdown;
                const progress =
                  state === "required" ? 1 : state === "soon" ? 1 - daysLeft / VERIFACTU_COUNTDOWN_DAYS : 0;
                return (
                  <li key={row.issuerId}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium">{row.name}</span>
                      <span
                        className={cn(
                          "shrink-0 text-xs font-semibold tabular",
                          state === "required" && "text-destructive",
                          state === "soon" && "text-warning",
                          state === "far" && "text-muted-foreground",
                        )}
                      >
                        {state === "required" ? t("verifactuRequired") : t("verifactuDays", { days: daysLeft })}
                      </span>
                    </div>
                    <div
                      className="mt-1.5 h-1.5 overflow-hidden rounded-full"
                      style={{ background: TRACK }}
                      role="img"
                      aria-label={t("verifactuMeter", { days: daysLeft, window: VERIFACTU_COUNTDOWN_DAYS })}
                    >
                      <div
                        className={cn("h-full rounded-full", state === "required" ? "bg-destructive" : state === "soon" ? "bg-warning" : "bg-muted-foreground/40")}
                        style={{ width: `${Math.max(state === "far" ? 0 : 3, progress * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t("verifactuFrom", { date: format.dateTime(civilToDate(row.verifactuFrom), { day: "numeric", month: "long", year: "numeric" }) })}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Lo que espera a un socio */}
        <div className="mt-auto grid grid-cols-2 gap-2">
          <Link
            href={`${view.basePath}/invoices`}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 text-xs leading-tight">
              <span className="block text-base font-bold tabular">{format.number(drafts)}</span>
              <span className="text-muted-foreground">{t("drafts", { count: drafts })}</span>
            </span>
          </Link>
          <Link
            href={`${view.basePath}/invoices`}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Mail aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 text-xs leading-tight">
              <span className="block text-base font-bold tabular">{format.number(remindersToApprove)}</span>
              <span className="text-muted-foreground">{t("reminders", { count: remindersToApprove })}</span>
            </span>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
