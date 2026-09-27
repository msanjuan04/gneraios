"use client";

import { CircleCheck, Clock, Download, Eye, Globe, ListTodo, Mail, MessagesSquare, Paperclip, Receipt, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useNow, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { SettingsCard } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { formatHours } from "@/domain/projects/duration";
import { recentReportMonths, reportMonthParam } from "@/domain/reports/month";
import { nowInZone } from "@/lib/clock";
import { cn } from "@/lib/utils";
import { prepareClientReportEmail } from "@/server/reports/actions";
import type { ClientReportSummary } from "./types";

type Loaded = { key: string; summary: ClientReportSummary | null; failed: boolean };

/** "catalán", en el idioma de la interfaz (el informe sale en el del cliente). */
function languageName(code: string, uiLocale: string): string {
  try {
    return new Intl.DisplayNames([uiLocale], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * «Informe mensual» en la ficha del cliente: elegir el mes (los 12 últimos cerrados, el pasado por
 * defecto), ver o descargar el PDF, y dejar el email preparado en Facturas → Por enviar para que un
 * socio lo revise y lo envíe. Antes de abrirlo, cuenta lo que saldrá (tareas, próximos pasos, web…)
 * con la misma regla que el PDF (GET …/summary).
 *
 * Para montarlo, solo para socios: `<ClientReportCard slug={org.slug} clientId={client.id}
 * timeZone={org.timezone} />`. No necesita datos de la página: los pide al abrirse.
 */
export function ClientReportCard({ slug, clientId, timeZone }: { slug: string; clientId: string; timeZone: string }) {
  const t = useTranslations("reports.card");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const now = useNow();
  const months = useMemo(() => recentReportMonths(nowInZone(timeZone, now).date).map(reportMonthParam), [timeZone, now]);
  const [month, setMonth] = useState(months[0]!);
  const [includeHours, setIncludeHours] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [preparing, startPreparing] = useTransition();

  const base = `/api/reports/clients/${clientId}/${month}`;
  const hoursQuery = includeHours ? "hours=1" : "";
  const key = `${base}?${hoursQuery}#${refresh}`;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${base}/summary${hoursQuery ? `?${hoursQuery}` : ""}`, { signal: controller.signal, cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<ClientReportSummary>) : Promise.reject(new Error(String(res.status)))))
      .then((summary) => setLoaded({ key, summary, failed: false }))
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ key, summary: null, failed: true });
      });
    return () => controller.abort();
  }, [base, hoursQuery, key]);

  const current = loaded?.key === key ? loaded : null;
  const summary = current?.summary ?? null;
  const monthLabel = (value: string) => {
    const text = format.dateTime(new Date(`${value}-15T12:00:00Z`), { month: "long", year: "numeric", timeZone: "UTC" });
    return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
  };
  const pdfHref = (download: boolean) => {
    const params = [hoursQuery, download ? "download=1" : ""].filter(Boolean).join("&");
    return `${base}/pdf${params ? `?${params}` : ""}`;
  };

  const prepare = () =>
    startPreparing(async () => {
      const result = await prepareClientReportEmail(slug, clientId, month, { includeHours });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.existing ? t("preparedExisting") : t("prepared"), {
        description: t("preparedHint"),
        action: { label: t("openOutbox"), onClick: () => router.push(`/${slug}/invoices/outbox`) },
      });
      setRefresh((n) => n + 1);
    });

  return (
    <SettingsCard
      title={t("title")}
      description={t("description", { language: summary ? languageName(summary.locale, locale) : "…" })}
      actions={
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger size="sm" className="w-44" aria-label={t("month")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((value) => (
              <SelectItem key={value} value={value}>
                {monthLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
      bodyClassName="space-y-3"
      footer={
        <>
          <Button asChild variant="ghost" size="sm">
            <a href={pdfHref(false)} target="_blank" rel="noopener">
              <Eye data-icon="inline-start" />
              {t("view")}
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={pdfHref(true)} download>
              <Download data-icon="inline-start" />
              {t("download")}
            </a>
          </Button>
          {summary?.email.pendingId ? (
            <Button asChild size="sm">
              <Link href={`/${slug}/invoices/outbox`}>
                <Mail data-icon="inline-start" />
                {t("review")}
              </Link>
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={prepare} disabled={preparing || !summary}>
              <Mail data-icon="inline-start" />
              {preparing ? t("preparing") : t("prepare")}
            </Button>
          )}
        </>
      }
    >
      {current === null ? (
        <div className="space-y-2" aria-busy="true">
          <span className="sr-only">{t("loading")}</span>
          <div className="flex flex-wrap gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-5 w-28 rounded-full" />
            ))}
          </div>
          <Skeleton className="h-4 w-64" />
        </div>
      ) : current.failed || !summary ? (
        <div className="flex items-center justify-between gap-3 text-muted-foreground">
          <p>{t("loadError")}</p>
          <Button type="button" variant="ghost" size="xs" onClick={() => setRefresh((n) => n + 1)}>
            <RotateCcw data-icon="inline-start" />
            {t("retry")}
          </Button>
        </div>
      ) : (
        <SummaryBody summary={summary} timeZone={timeZone} />
      )}

      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
        <Switch size="sm" checked={includeHours} onCheckedChange={setIncludeHours} />
        <span>
          {includeHours && summary?.counts.hoursMinutes != null
            ? t("hoursValue", { hours: formatHours(summary.counts.hoursMinutes, locale) })
            : t("hours")}
        </span>
      </label>
    </SettingsCard>
  );
}

function SummaryBody({ summary, timeZone }: { summary: ClientReportSummary; timeZone: string }) {
  const t = useTranslations("reports.card");
  const format = useFormatter();
  const locale = useLocale();
  const { counts, email } = summary;
  const webOn = counts.webStatus === "included";
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary">
          <CircleCheck />
          {t("tasksDone", { count: counts.tasksDone })}
        </Badge>
        {counts.activities > 0 && (
          <Badge variant="secondary">
            <MessagesSquare />
            {t("activities", { count: counts.activities })}
          </Badge>
        )}
        <Badge variant="secondary">
          <ListTodo />
          {t("nextSteps", { count: counts.nextSteps })}
        </Badge>
        {counts.deliverables > 0 && (
          <Badge variant="secondary">
            <Paperclip />
            {t("deliverables", { count: counts.deliverables })}
          </Badge>
        )}
        <Badge variant="secondary" className={cn(!webOn && "text-muted-foreground")}>
          <Globe />
          {t(`web.${counts.webStatus}`)}
        </Badge>
        <Badge variant="secondary">
          <Receipt />
          {t("invoices", { count: counts.invoices })}
        </Badge>
        {counts.hoursMinutes !== null && (
          <Badge variant="secondary">
            <Clock />
            {formatHours(counts.hoursMinutes, locale)}
          </Badge>
        )}
      </div>
      <div className="space-y-0.5 text-xs text-muted-foreground">
        {summary.inProgress && <p>{t("inProgress")}</p>}
        {summary.recipients.length > 0 ? (
          <p className="truncate">{t("to", { emails: summary.recipients.join(", ") })}</p>
        ) : (
          <p className="text-warning">{t("noRecipients")}</p>
        )}
        {email.lastSentAt && (
          <p>{t("sentAt", { date: format.dateTime(new Date(email.lastSentAt), { dateStyle: "medium", timeStyle: "short", timeZone }) })}</p>
        )}
        {email.pendingId && <p>{t("pending")}</p>}
        <p>{t("visibility")}</p>
      </div>
    </>
  );
}
